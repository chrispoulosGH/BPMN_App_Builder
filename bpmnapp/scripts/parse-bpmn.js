import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const outputDir = path.resolve(projectRoot, 'output');

const defaultInputPath = path.resolve(workspaceRoot, 'xml', 'Troubleshoot Repair Consumer Broadband_BPMN2.0_di.xml');
const cliInput = process.argv[2]?.trim();
const inputPath = cliInput ? path.resolve(workspaceRoot, cliInput) : defaultInputPath;

const toSafeBaseName = (filePath) => {
  const parsed = path.parse(filePath);
  return parsed.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
};

const outputBaseName = `${toSafeBaseName(inputPath)}_dataframe`;
const outputJson = path.resolve(outputDir, `${outputBaseName}.json`);
const outputCsv = path.resolve(outputDir, `${outputBaseName}.csv`);

const csvEscape = (value) => {
  const stringValue = String(value ?? '');
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const parseBusinessFlowName = (definitions, filePath) => {
  const diagramName = definitions.diagrams?.[0]?.name || '';
  const marker = 'Business Flow:';
  const markerIndex = diagramName.indexOf(marker);
  if (markerIndex >= 0) {
    const fromMetadata = diagramName.slice(markerIndex + marker.length).trim();
    if (fromMetadata) {
      return fromMetadata.split(/\s+/)[0];
    }
  }

  const baseName = path.parse(filePath).name;
  const firstToken = baseName.split('_')[0]?.trim();
  return firstToken || baseName;
};

const gatewayCodePrefix = (nodeType) => {
  if (nodeType === 'bpmn:parallelGateway') {
    return 'P';
  }
  if (nodeType === 'bpmn:exclusiveGateway') {
    return 'X';
  }
  if (nodeType === 'bpmn:inclusiveGateway') {
    return 'O';
  }
  if (nodeType === 'bpmn:eventBasedGateway') {
    return 'E';
  }
  if (nodeType === 'bpmn:complexGateway') {
    return 'C';
  }
  return 'G';
};

const formatSequence = (segments) => segments.join('.');

const incrementRootSequence = (sequenceSegments) => {
  if (!sequenceSegments.length) {
    return [0];
  }
  const next = [...sequenceSegments];
  next[next.length - 1] += 1;
  return next;
};

const nextLinearSequence = (sequenceSegments, branchBaseDepth) => {
  if (branchBaseDepth === null || branchBaseDepth === undefined) {
    return incrementRootSequence(sequenceSegments);
  }

  if (sequenceSegments.length === branchBaseDepth + 1) {
    return [...sequenceSegments, 1];
  }

  const next = [...sequenceSegments];
  next[next.length - 1] += 1;
  return next;
};

const gatewayBpmnTypeFromJson = (gatewayType) => {
  const type = String(gatewayType || '').toLowerCase();
  if (type === 'parallel') {
    return 'bpmn:parallelGateway';
  }
  if (type === 'inclusive') {
    return 'bpmn:inclusiveGateway';
  }
  if (type === 'eventbased') {
    return 'bpmn:eventBasedGateway';
  }
  if (type === 'complex') {
    return 'bpmn:complexGateway';
  }
  return 'bpmn:exclusiveGateway';
};

const buildDefinitionsFromDiagramJson = (rawData, filePath) => {
  const items = Array.isArray(rawData) ? rawData : Array.isArray(rawData?.diagram) ? rawData.diagram : [];
  const laneItems = items.filter((item) => item?.type === 'lane' && item?.shape === 'rectangle');
  const flowItems = items.filter((item) => item?.type === 'flow' || item?.shape === 'line');
  const nodeItems = items.filter((item) => !flowItems.includes(item) && item?.id);

  const incomingCount = new Map();
  const outgoingCount = new Map();
  for (const flow of flowItems) {
    const sourceRef = String(flow?.sourceRef || '');
    const targetRef = String(flow?.targetRef || '');
    if (!sourceRef || !targetRef) {
      continue;
    }
    outgoingCount.set(sourceRef, (outgoingCount.get(sourceRef) || 0) + 1);
    incomingCount.set(targetRef, (incomingCount.get(targetRef) || 0) + 1);
  }

  const flowElements = [];

  for (const node of nodeItems) {
    const nodeId = String(node.id || '');
    if (!nodeId) {
      continue;
    }

    let bpmnType = null;
    if (node.shape === 'diamond') {
      bpmnType = gatewayBpmnTypeFromJson(node.type);
    } else if (node.type === 'task') {
      bpmnType = 'bpmn:Task';
    } else if (node.type === 'event') {
      const incoming = incomingCount.get(nodeId) || 0;
      const outgoing = outgoingCount.get(nodeId) || 0;
      bpmnType = incoming > 0 && outgoing === 0 ? 'bpmn:EndEvent' : 'bpmn:StartEvent';
    }

    if (!bpmnType) {
      continue;
    }

    flowElements.push({
      id: nodeId,
      name: node.name || '',
      $type: bpmnType,
    });
  }

  for (const flow of flowItems) {
    const flowId = String(flow?.id || '');
    const sourceRef = String(flow?.sourceRef || '');
    const targetRef = String(flow?.targetRef || '');
    if (!flowId || !sourceRef || !targetRef) {
      continue;
    }

    flowElements.push({
      id: flowId,
      $type: 'bpmn:SequenceFlow',
      sourceRef,
      targetRef,
    });
  }

  const lanes = laneItems.map((lane) => {
    const x = Number(lane.x || 0);
    const y = Number(lane.y || 0);
    const width = Number(lane.width || 0);
    const height = Number(lane.height || 0);
    const laneRight = x + width;
    const laneBottom = y + height;

    const refs = [];
    for (const node of nodeItems) {
      if (!node?.id || node?.shape === 'line' || node?.type === 'flow') {
        continue;
      }
      const nodeX = Number(node.x || 0);
      const nodeY = Number(node.y || 0);
      const nodeWidth = Number(node.width || 0);
      const nodeHeight = Number(node.height || 0);
      const centerX = nodeX + nodeWidth / 2;
      const centerY = nodeY + nodeHeight / 2;
      if (centerX >= x && centerX <= laneRight && centerY >= y && centerY <= laneBottom) {
        refs.push({ id: node.id });
      }
    }

    return {
      id: String(lane.id || ''),
      name: lane.name || '',
      flowNodeRef: refs,
    };
  });

  const process = {
    $type: 'bpmn:Process',
    laneSets: [{ lanes }],
    flowElements,
  };

  const businessFlowToken = path.parse(filePath).name.split('_')[0] || 'Flow';
  return {
    rootElements: [process],
    diagrams: [{ name: `Business Flow: ${businessFlowToken}` }],
  };
};

const parseRows = (definitions, filePath) => {
  const process = (definitions.rootElements || []).find((element) => element.$type === 'bpmn:Process');
  if (!process) {
    throw new Error('No bpmn:Process found in XML.');
  }

  const nodesById = new Map();
  const outgoingByNode = new Map();
  const incomingByNode = new Map();
  const actorByNodeId = new Map();
  const gatewayCounters = new Map();

  for (const laneSet of process.laneSets || []) {
    for (const lane of laneSet.lanes || []) {
      const actor = (lane.name || '').trim();
      for (const flowNodeRef of lane.flowNodeRef || []) {
        const nodeId = typeof flowNodeRef === 'string' ? flowNodeRef : flowNodeRef.id;
        if (nodeId) {
          actorByNodeId.set(nodeId, actor || '');
        }
      }
    }
  }

  for (const element of process.flowElements || []) {
    if (element.$type === 'bpmn:SequenceFlow') {
      const sourceRef = element.sourceRef?.id || element.sourceRef;
      const targetRef = element.targetRef?.id || element.targetRef;
      if (!sourceRef || !targetRef) {
        continue;
      }

      if (!outgoingByNode.has(sourceRef)) {
        outgoingByNode.set(sourceRef, []);
      }
      outgoingByNode.get(sourceRef).push(targetRef);

      if (!incomingByNode.has(targetRef)) {
        incomingByNode.set(targetRef, []);
      }
      incomingByNode.get(targetRef).push(sourceRef);
      continue;
    }

    nodesById.set(element.id, element);
  }

  const isGateway = (node) => Boolean(node && node.$type?.endsWith('Gateway'));
  const isTask = (node) => Boolean(node && (node.$type === 'bpmn:Task' || node.$type === 'bpmn:SubProcess'));
  const isEndEvent = (node) => node?.$type === 'bpmn:EndEvent';

  const nextGatewayCode = (gatewayNode) => {
    const prefix = gatewayCodePrefix(gatewayNode.$type);
    const nextNumber = (gatewayCounters.get(prefix) || 0) + 1;
    gatewayCounters.set(prefix, nextNumber);
    return `${prefix}${nextNumber}`;
  };

  const startEvent = [...nodesById.values()].find((node) => node.$type === 'bpmn:StartEvent');
  if (!startEvent) {
    return [];
  }

  const businessFlow = parseBusinessFlowName(definitions, filePath);
  const rows = [];

  const createRow = (nodeId, sequenceSegments, gatewayCode) => {
    const node = nodesById.get(nodeId);
    if (!node || !isTask(node)) {
      return;
    }

    rows.push({
      business_flow: businessFlow,
      e2eux_sequence: formatSequence(sequenceSegments),
      gateway: gatewayCode || '',
      e2eux_actor: actorByNodeId.get(nodeId) || '',
      e2eux: node.name || node.id,
    });
  };

  const findJoinGatewayId = (forkGatewayId) => {
    const forkNode = nodesById.get(forkGatewayId);
    if (!forkNode || !isGateway(forkNode)) {
      return null;
    }

    const forkTargets = outgoingByNode.get(forkGatewayId) || [];
    if (forkTargets.length < 2) {
      return null;
    }

    for (const candidate of nodesById.values()) {
      if (!isGateway(candidate) || candidate.$type !== forkNode.$type) {
        continue;
      }

      const candidateId = candidate.id;
      const candidateIncoming = incomingByNode.get(candidateId) || [];
      const candidateOutgoing = outgoingByNode.get(candidateId) || [];
      if (candidateIncoming.length < 2 || candidateOutgoing.length !== 1 || candidateId === forkGatewayId) {
        continue;
      }

      let allBranchesReach = true;
      for (const branchStart of forkTargets) {
        const stack = [branchStart];
        const seen = new Set();
        let reaches = false;

        while (stack.length) {
          const currentId = stack.pop();
          if (!currentId || seen.has(currentId)) {
            continue;
          }
          seen.add(currentId);

          if (currentId === candidateId) {
            reaches = true;
            break;
          }

          const nextIds = outgoingByNode.get(currentId) || [];
          for (const nextId of nextIds) {
            stack.push(nextId);
          }
        }

        if (!reaches) {
          allBranchesReach = false;
          break;
        }
      }

      if (allBranchesReach) {
        return candidateId;
      }
    }

    return null;
  };

  const walkPath = (nodeId, sequenceSegments, context) => {
    const node = nodesById.get(nodeId);
    if (!node) {
      return sequenceSegments;
    }

    if (isTask(node)) {
      createRow(nodeId, sequenceSegments, context.gatewayCode);
      const nextTargets = outgoingByNode.get(nodeId) || [];
      if (!nextTargets.length) {
        return sequenceSegments;
      }

      let currentSequence = sequenceSegments;
      for (const nextTargetId of nextTargets) {
        const nextSequence = nextLinearSequence(currentSequence, context.branchBaseDepth);
        currentSequence = walkPath(nextTargetId, nextSequence, context);
      }

      return currentSequence;
    }

    if (isEndEvent(node)) {
      return sequenceSegments;
    }

    if (!isGateway(node)) {
      const nextTargets = outgoingByNode.get(nodeId) || [];
      if (!nextTargets.length) {
        return sequenceSegments;
      }
      return walkPath(nextTargets[0], sequenceSegments, context);
    }

    const nextTargets = outgoingByNode.get(nodeId) || [];
    if (!nextTargets.length) {
      return sequenceSegments;
    }

    if (nextTargets.length === 1) {
      return walkPath(nextTargets[0], sequenceSegments, context);
    }

    const joinGatewayId = findJoinGatewayId(nodeId);
    const gatewayCode = nextGatewayCode(node);
    const branchSequences = [];

    const walkBranchUntilJoin = (branchStartId, branchSequence, branchContext) => {
      const stack = [{ currentId: branchStartId, seq: branchSequence }];

      while (stack.length) {
        const current = stack.pop();
        if (!current) {
          continue;
        }

        if (current.currentId === joinGatewayId) {
          return current.seq;
        }

        const currentNode = nodesById.get(current.currentId);
        if (!currentNode) {
          continue;
        }

        if (isTask(currentNode)) {
          createRow(current.currentId, current.seq, branchContext.gatewayCode);
          const linearTargets = outgoingByNode.get(current.currentId) || [];
          if (!linearTargets.length) {
            return current.seq;
          }

          let seqPointer = current.seq;
          for (const linearTarget of linearTargets) {
            const nextSeq = nextLinearSequence(seqPointer, branchContext.branchBaseDepth);
            stack.push({ currentId: linearTarget, seq: nextSeq });
            seqPointer = nextSeq;
          }
          continue;
        }

        if (isGateway(currentNode)) {
          const gatewayTargets = outgoingByNode.get(current.currentId) || [];
          if (gatewayTargets.length > 1) {
            const nestedJoinId = findJoinGatewayId(current.currentId);
            const nestedGatewayCode = nextGatewayCode(currentNode);
            let nestedBaseSequence = current.seq;

            gatewayTargets.forEach((gatewayTargetId, gatewayIndex) => {
              const nestedBranchSequence = [...current.seq, gatewayIndex + 1];
              const nestedFinalSeq = walkBranchUntilJoin(gatewayTargetId, nestedBranchSequence, {
                gatewayCode: nestedGatewayCode,
                branchBaseDepth: current.seq.length,
              });
              if (gatewayIndex === 0) {
                nestedBaseSequence = nestedFinalSeq;
              }
            });

            if (nestedJoinId) {
              const nestedJoinTargets = outgoingByNode.get(nestedJoinId) || [];
              if (nestedJoinTargets.length) {
                stack.push({
                  currentId: nestedJoinTargets[0],
                  seq: nestedBaseSequence,
                });
              }
            }
            continue;
          }

          if (gatewayTargets.length === 1) {
            stack.push({ currentId: gatewayTargets[0], seq: current.seq });
          }
          continue;
        }

        if (isEndEvent(currentNode)) {
          return current.seq;
        }

        const passthroughTargets = outgoingByNode.get(current.currentId) || [];
        if (passthroughTargets.length) {
          stack.push({ currentId: passthroughTargets[0], seq: current.seq });
        }
      }

      return branchSequence;
    };

    nextTargets.forEach((targetId, index) => {
      const branchSequence = [...sequenceSegments, index + 1];
      const branchFinalSequence = walkBranchUntilJoin(targetId, branchSequence, {
        gatewayCode,
        branchBaseDepth: sequenceSegments.length,
      });
      branchSequences.push(branchFinalSequence);
    });

    if (!joinGatewayId) {
      return branchSequences[0] || sequenceSegments;
    }

    const joinTargets = outgoingByNode.get(joinGatewayId) || [];
    if (!joinTargets.length) {
      return branchSequences[0] || sequenceSegments;
    }

    return walkPath(joinTargets[0], branchSequences[0] || sequenceSegments, context);
  };

  const startTargets = outgoingByNode.get(startEvent.id) || [];
  if (!startTargets.length) {
    return rows;
  }

  walkPath(startTargets[0], [0], { gatewayCode: '', branchBaseDepth: null });
  return rows;
};

const toCsv = (rows) => {
  const header = 'business_flow,e2eux_sequence,gateway,e2eux_actor,e2eux';
  const lines = rows.map((row) => [
    csvEscape(row.business_flow),
    csvEscape(row.e2eux_sequence),
    csvEscape(row.gateway),
    csvEscape(row.e2eux_actor),
    csvEscape(row.e2eux),
  ].join(','));
  return [header, ...lines].join('\n');
};

const run = async () => {
  const extension = path.extname(inputPath).toLowerCase();
  const fileContents = await readFile(inputPath, 'utf8');

  let definitions;
  if (extension === '.json') {
    const parsedJson = JSON.parse(fileContents);
    definitions = buildDefinitionsFromDiagramJson(parsedJson, inputPath);
  } else {
    const moddle = new BpmnModdle();
    const { rootElement, warnings } = await moddle.fromXML(fileContents);
    if (warnings?.length) {
      console.warn(`Parsed with ${warnings.length} warning(s).`);
    }
    definitions = rootElement;
  }

  const rows = parseRows(definitions, inputPath);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  await writeFile(outputCsv, `${toCsv(rows)}\n`, 'utf8');

  console.log(`Input: ${inputPath}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`JSON: ${outputJson}`);
  console.log(`CSV: ${outputCsv}`);
  console.table(rows.slice(0, 12));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
