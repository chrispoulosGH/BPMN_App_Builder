import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const CANVAS_PADDING = 50
const MIN_LEFT_PANEL_PERCENT = 12
const MAX_LEFT_PANEL_PERCENT = 55
const LEFT_PANEL_PERCENT_STORAGE_KEY = 'bpmn-iq:left-panel-percent'
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1
const NOTE_WIDTH = 180
const NOTE_HEIGHT = 130
const NOTE_DEFAULT_COLOR = '#fef08a'
const NOTE_SWATCH_COLORS = ['#fef08a', '#fecaca', '#bfdbfe', '#bbf7d0', '#e9d5ff', '#fed7aa']
const NOTE_COLLAPSED_WIDTH = 54
const NOTE_COLLAPSED_HEIGHT = 34
const EXTRA_PAN_SPACE_X_LEFT = 1800
const EXTRA_PAN_SPACE_X_RIGHT = 2600
const EXTRA_PAN_SPACE_Y_TOP = 2600
const EXTRA_PAN_SPACE_Y = 2600
const NOTE_MIN_WIDTH = 120
const NOTE_MIN_HEIGHT = 90
const NOTE_RESIZE_HANDLE_SIZE = 14
const APPLICATIONS_DIALOG_WIDTH = 420
const APPLICATIONS_DIALOG_HEIGHT = 300
const SUBPROCESSES_DIALOG_WIDTH = 420
const SUBPROCESSES_DIALOG_HEIGHT = 300
const METRICS_DIALOG_WIDTH = 320
const METRICS_DIALOG_HEIGHT = 180
const OUTAGES_DIALOG_WIDTH = 520
const OUTAGES_DIALOG_HEIGHT = 320
const TASK_EXPAND_ANIMATION_MS = 620
const FLOW_DOT_SPEED = 180
const FLOW_DOT_RADIUS = 5
const FLOW_SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
]
const GATEWAY_LEGEND_ITEMS = [
  { type: 'exclusive', label: 'XOR' },
  { type: 'inclusive', label: 'OR' },
  { type: 'parallel', label: 'AND' },
  { type: 'eventbased', label: 'Event' },
  { type: 'complex', label: 'Complex' },
]
const THEME_OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'forest', label: 'Forest' },
  { value: 'lavender', label: 'Lavender' },
  { value: 'mono', label: 'Mono' },
  { value: 'neon', label: 'Neon' },
]

function parseNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getNoteWidth(note) {
  return Math.max(NOTE_MIN_WIDTH, parseNumber(note?.width) ?? NOTE_WIDTH)
}

function getNoteHeight(note) {
  return Math.max(NOTE_MIN_HEIGHT, parseNumber(note?.height) ?? NOTE_HEIGHT)
}

function formatDurationToSeconds(value) {
  if (value === undefined || value === null) {
    return 'N/A'
  }

  const raw = `${value}`.trim()
  if (!raw) {
    return 'N/A'
  }

  const numericMatch = raw.match(/-?\d+(?:\.\d+)?/)
  if (!numericMatch) {
    return raw
  }

  const numericValue = Number(numericMatch[0])
  if (!Number.isFinite(numericValue)) {
    return 'N/A'
  }

  const normalized = raw.toLowerCase()
  let seconds = numericValue

  if (normalized.includes('milli') || normalized.includes(' ms') || normalized.endsWith('ms')) {
    seconds = numericValue / 1000
  } else if (normalized.includes('minute') || normalized.includes(' min')) {
    seconds = numericValue * 60
  } else if (normalized.includes('hour') || normalized.includes(' hr')) {
    seconds = numericValue * 3600
  } else if (!(normalized.includes('sec') || normalized.endsWith('s'))) {
    seconds = numericValue / 1000
  }

  const roundedSeconds = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)
  const prettySeconds = roundedSeconds.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
  return `${prettySeconds} sec`
}

function parseAvgDurationFromMetrics(metrics) {
  if (!Array.isArray(metrics)) {
    return null
  }

  for (const entry of metrics) {
    if (typeof entry !== 'string') {
      continue
    }

    const normalizedEntry = entry.trim()
    if (!normalizedEntry) {
      continue
    }

    const valueMatch = normalizedEntry.match(/key\s*=\s*avg\s*duration[\s\S]*?value\s*=\s*([^\r\n]+)/i)
    if (valueMatch?.[1]) {
      return valueMatch[1].trim()
    }
  }

  return null
}

function getTaskAvgDuration(task) {
  if (!task || typeof task !== 'object') {
    return 'N/A'
  }

  const directCandidates = [
    task.avgDuration,
    task.avg_duration,
    task.averageDuration,
    task.durationAvg,
    task['Avg Duration'],
  ]

  for (const candidate of directCandidates) {
    if (candidate !== undefined && candidate !== null && `${candidate}`.trim()) {
      return formatDurationToSeconds(candidate)
    }
  }

  const metricsValue = parseAvgDurationFromMetrics(task.metrics)
  if (metricsValue) {
    return formatDurationToSeconds(metricsValue)
  }

  return 'N/A'
}

function getNoteColor(note) {
  return typeof note?.color === 'string' && note.color.trim() ? note.color : NOTE_DEFAULT_COLOR
}

function getRenderedNoteWidth(note, notesCollapsed) {
  return notesCollapsed ? NOTE_COLLAPSED_WIDTH : getNoteWidth(note)
}

function getRenderedNoteHeight(note, notesCollapsed) {
  return notesCollapsed ? NOTE_COLLAPSED_HEIGHT : getNoteHeight(note)
}

function getBounds(items, notes = [], notesCollapsed = false) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const item of items) {
    if (Array.isArray(item.waypoints) && item.waypoints.length) {
      for (const waypoint of item.waypoints) {
        const x = parseNumber(waypoint?.x)
        const y = parseNumber(waypoint?.y)
        if (x === null || y === null) {
          continue
        }

        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      continue
    }

    const x = parseNumber(item.x)
    const y = parseNumber(item.y)
    const width = parseNumber(item.width)
    const height = parseNumber(item.height)

    if (x === null || y === null) {
      continue
    }

    const right = width === null ? x : x + width
    const bottom = height === null ? y : y + height

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, right)
    maxY = Math.max(maxY, bottom)
  }

  for (const note of notes) {
    const x = parseNumber(note?.x)
    const y = parseNumber(note?.y)
    if (x === null || y === null) {
      continue
    }

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + getRenderedNoteWidth(note, notesCollapsed))
    maxY = Math.max(maxY, y + getRenderedNoteHeight(note, notesCollapsed))
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
      width: 1200,
      height: 800,
      offsetX: CANVAS_PADDING + EXTRA_PAN_SPACE_X_LEFT,
      offsetY: CANVAS_PADDING + EXTRA_PAN_SPACE_Y_TOP,
      canvasWidth: 1200 + CANVAS_PADDING * 2 + EXTRA_PAN_SPACE_X_LEFT + EXTRA_PAN_SPACE_X_RIGHT,
      canvasHeight: 800 + CANVAS_PADDING * 2 + EXTRA_PAN_SPACE_Y_TOP + EXTRA_PAN_SPACE_Y,
    }
  }

  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    offsetX: CANVAS_PADDING + EXTRA_PAN_SPACE_X_LEFT - minX,
    offsetY: CANVAS_PADDING + EXTRA_PAN_SPACE_Y_TOP - minY,
    canvasWidth: Math.ceil(width + CANVAS_PADDING * 2 + EXTRA_PAN_SPACE_X_LEFT + EXTRA_PAN_SPACE_X_RIGHT),
    canvasHeight: Math.ceil(height + CANVAS_PADDING * 2 + EXTRA_PAN_SPACE_Y_TOP + EXTRA_PAN_SPACE_Y),
  }
}

function drawMultilineCenteredText(ctx, text, centerX, centerY, maxWidth, lineHeight) {
  if (!text) {
    return
  }

  const words = String(text).split(/\s+/).filter(Boolean)
  if (!words.length) {
    return
  }

  const lines = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }

  if (current) {
    lines.push(current)
  }

  const totalHeight = lines.length * lineHeight
  let y = centerY - totalHeight / 2 + lineHeight * 0.8

  for (const line of lines) {
    ctx.fillText(line, centerX, y)
    y += lineHeight
  }
}

function getWrappedLines(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  if (!words.length) {
    return []
  }

  const lines = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

function getFittedNoteText(ctx, text, maxWidth, maxHeight) {
  const normalizedText = String(text || '')

  for (let fontSize = 14; fontSize >= 9; fontSize -= 1) {
    const lineHeight = Math.round(fontSize * 1.35)
    ctx.font = `${fontSize}px Arial, sans-serif`
    const lines = getWrappedLines(ctx, normalizedText, maxWidth)
    if (lines.length * lineHeight <= maxHeight) {
      return { fontSize, lineHeight, lines }
    }
  }

  const fontSize = 9
  const lineHeight = Math.round(fontSize * 1.35)
  ctx.font = `${fontSize}px Arial, sans-serif`
  const lines = getWrappedLines(ctx, normalizedText, maxWidth)
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight))
  return { fontSize, lineHeight, lines: lines.slice(0, maxLines) }
}

function drawArrowHead(ctx, fromX, fromY, toX, toY, color) {
  const angle = Math.atan2(toY - fromY, toX - fromX)
  const size = 9
  const spread = Math.PI / 7

  const leftX = toX - size * Math.cos(angle - spread)
  const leftY = toY - size * Math.sin(angle - spread)
  const rightX = toX - size * Math.cos(angle + spread)
  const rightY = toY - size * Math.sin(angle + spread)

  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(toX, toY)
  ctx.lineTo(leftX, leftY)
  ctx.lineTo(rightX, rightY)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function getCanvasPoint(event, canvas, zoomLevel = 1) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) / zoomLevel,
    y: (event.clientY - rect.top) / zoomLevel,
  }
}

function getOverlayPosition(wrap, clientX, clientY, overlayWidth, overlayHeight) {
  const rect = wrap.getBoundingClientRect()
  const rawX = clientX - rect.left + wrap.scrollLeft
  const rawY = clientY - rect.top + wrap.scrollTop
  const margin = 8
  const minX = wrap.scrollLeft + margin
  const minY = wrap.scrollTop + margin
  const maxX = wrap.scrollLeft + wrap.clientWidth - overlayWidth - margin
  const maxY = wrap.scrollTop + wrap.clientHeight - overlayHeight - margin

  return {
    x: Math.max(minX, Math.min(rawX, maxX)),
    y: Math.max(minY, Math.min(rawY, maxY)),
  }
}

function clampOverlayPosition(wrap, x, y, overlayWidth, overlayHeight) {
  const margin = 8
  const minX = wrap.scrollLeft + margin
  const minY = wrap.scrollTop + margin
  const maxX = wrap.scrollLeft + wrap.clientWidth - overlayWidth - margin
  const maxY = wrap.scrollTop + wrap.clientHeight - overlayHeight - margin

  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY)),
  }
}

function findTaskAtPoint(items, bounds, x, y) {
  const { offsetX, offsetY } = bounds

  for (const item of items) {
    if (item.type !== 'task' || item.shape !== 'rectangle') {
      continue
    }

    const left = (parseNumber(item.x) ?? 0) + offsetX
    const top = (parseNumber(item.y) ?? 0) + offsetY
    const width = parseNumber(item.width) ?? 0
    const height = parseNumber(item.height) ?? 0

    if (x >= left && x <= left + width && y >= top && y <= top + height) {
      return item
    }
  }

  return null
}

function findNoteAtPoint(notes, bounds, x, y, notesCollapsed = false) {
  const { offsetX, offsetY } = bounds

  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    const left = (parseNumber(note.x) ?? 0) + offsetX
    const top = (parseNumber(note.y) ?? 0) + offsetY
    const width = getRenderedNoteWidth(note, notesCollapsed)
    const height = getRenderedNoteHeight(note, notesCollapsed)

    if (x >= left && x <= left + width && y >= top && y <= top + height) {
      return note
    }
  }

  return null
}

function findNoteResizeHandleAtPoint(notes, bounds, x, y, notesCollapsed = false) {
  if (notesCollapsed) {
    return null
  }

  const { offsetX, offsetY } = bounds

  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    const left = (parseNumber(note.x) ?? 0) + offsetX
    const top = (parseNumber(note.y) ?? 0) + offsetY
    const width = getNoteWidth(note)
    const height = getNoteHeight(note)
    const handleLeft = left + width - NOTE_RESIZE_HANDLE_SIZE
    const handleTop = top + height - NOTE_RESIZE_HANDLE_SIZE

    if (x >= handleLeft && x <= left + width && y >= handleTop && y <= top + height) {
      return note
    }
  }

  return null
}

function getFlowGeometry(flow) {
  const waypoints = Array.isArray(flow?.waypoints) ? flow.waypoints : []
  if (waypoints.length < 2) {
    return null
  }

  const cumulative = [0]
  let totalLength = 0

  for (let index = 1; index < waypoints.length; index += 1) {
    const prevX = parseNumber(waypoints[index - 1]?.x)
    const prevY = parseNumber(waypoints[index - 1]?.y)
    const currX = parseNumber(waypoints[index]?.x)
    const currY = parseNumber(waypoints[index]?.y)
    if (prevX === null || prevY === null || currX === null || currY === null) {
      return null
    }

    const segmentLength = Math.hypot(currX - prevX, currY - prevY)
    totalLength += segmentLength
    cumulative.push(totalLength)
  }

  if (totalLength <= 0) {
    return null
  }

  return {
    id: flow.id,
    sourceRef: String(flow.sourceRef || ''),
    targetRef: String(flow.targetRef || ''),
    waypoints,
    cumulative,
    totalLength,
  }
}

function getPointOnFlow(geometry, distance) {
  const clampedDistance = Math.max(0, Math.min(geometry.totalLength, distance))
  const { waypoints, cumulative } = geometry

  for (let index = 1; index < cumulative.length; index += 1) {
    if (clampedDistance > cumulative[index]) {
      continue
    }

    const start = waypoints[index - 1]
    const end = waypoints[index]
    const segmentStart = cumulative[index - 1]
    const segmentLength = Math.max(1e-6, cumulative[index] - segmentStart)
    const t = (clampedDistance - segmentStart) / segmentLength

    return {
      x: (start.x ?? 0) + ((end.x ?? 0) - (start.x ?? 0)) * t,
      y: (start.y ?? 0) + ((end.y ?? 0) - (start.y ?? 0)) * t,
    }
  }

  const lastWaypoint = waypoints[waypoints.length - 1]
  return {
    x: lastWaypoint?.x ?? 0,
    y: lastWaypoint?.y ?? 0,
  }
}

function buildFlowAnimationGraph(items) {
  const nodeById = new Map(
    items
      .filter((item) => item?.shape !== 'line' && item?.id)
      .map((item) => [String(item.id), item])
  )

  const flows = items.filter((item) => item?.shape === 'line')
  const flowsById = new Map()
  const outgoingByNode = new Map()
  const incomingCountByNode = new Map()

  for (const flow of flows) {
    const id = String(flow?.id || '')
    if (!id) {
      continue
    }

    const geometry = getFlowGeometry(flow)
    if (!geometry) {
      continue
    }

    flowsById.set(id, geometry)

    const source = geometry.sourceRef
    const target = geometry.targetRef

    if (!outgoingByNode.has(source)) {
      outgoingByNode.set(source, [])
    }
    outgoingByNode.get(source).push(id)

    incomingCountByNode.set(target, (incomingCountByNode.get(target) || 0) + 1)
    if (!incomingCountByNode.has(source)) {
      incomingCountByNode.set(source, incomingCountByNode.get(source) || 0)
    }
  }

  const startNodeIds = []
  for (const [nodeId] of nodeById) {
    const incoming = incomingCountByNode.get(nodeId) || 0
    const outgoing = (outgoingByNode.get(nodeId) || []).length
    if (outgoing > 0 && incoming === 0) {
      startNodeIds.push(nodeId)
    }
  }

  if (!startNodeIds.length) {
    for (const [nodeId, outgoing] of outgoingByNode) {
      if (outgoing.length) {
        startNodeIds.push(nodeId)
      }
    }
  }

  return {
    nodeById,
    flowsById,
    outgoingByNode,
    incomingCountByNode,
    startNodeIds,
  }
}

function spawnInitialTokens(flowGraph) {
  const tokens = []
  for (const nodeId of flowGraph.startNodeIds) {
    const outgoing = flowGraph.outgoingByNode.get(nodeId) || []
    for (const flowId of outgoing) {
      tokens.push({ flowId, distance: 0 })
    }
  }

  if (!tokens.length) {
    for (const [flowId] of flowGraph.flowsById) {
      tokens.push({ flowId, distance: 0 })
      break
    }
  }

  return tokens
}

function pickRandomOutgoingFlows(flowIds, pickCount) {
  const result = []
  const pool = [...flowIds]
  const count = Math.max(1, Math.min(pickCount, pool.length))

  for (let index = 0; index < count; index += 1) {
    const randomIndex = Math.floor(Math.random() * pool.length)
    const selected = pool.splice(randomIndex, 1)[0]
    if (selected) {
      result.push(selected)
    }
  }

  return result
}

function getGatewayDispatchFlowIds(node, outgoingFlowIds) {
  if (!node || node.shape !== 'diamond' || outgoingFlowIds.length <= 1) {
    return outgoingFlowIds
  }

  const markerType = getGatewayMarkerType(node)

  if (markerType === 'parallel') {
    return outgoingFlowIds
  }

  if (markerType === 'exclusive' || markerType === 'eventbased') {
    return pickRandomOutgoingFlows(outgoingFlowIds, 1)
  }

  if (markerType === 'inclusive' || markerType === 'complex') {
    const pickCount = 1 + Math.floor(Math.random() * outgoingFlowIds.length)
    return pickRandomOutgoingFlows(outgoingFlowIds, pickCount)
  }

  return outgoingFlowIds
}

function advanceFlowTokens(tokens, flowGraph, distanceStep, joinWaitCounts) {
  const nextTokens = []
  const arrivalQueue = []

  const pushTokenOnFlow = (flowId, carryDistance) => {
    const geometry = flowGraph.flowsById.get(flowId)
    if (!geometry) {
      return
    }

    if (carryDistance >= geometry.totalLength) {
      arrivalQueue.push({ nodeId: geometry.targetRef, carryDistance: carryDistance - geometry.totalLength })
      return
    }

    nextTokens.push({ flowId, distance: Math.max(0, carryDistance) })
  }

  const dispatchFromNode = (nodeId, carryDistance) => {
    const outgoing = flowGraph.outgoingByNode.get(nodeId) || []
    if (!outgoing.length) {
      return
    }

    const node = flowGraph.nodeById.get(nodeId)
    const incomingCount = flowGraph.incomingCountByNode.get(nodeId) || 0
    const markerType = node && node.shape === 'diamond' ? getGatewayMarkerType(node) : 'unknown'
    const isSynchronizedJoin = Boolean(
      node && node.shape === 'diamond' && markerType === 'parallel' && incomingCount > 1 && outgoing.length === 1
    )

    if (isSynchronizedJoin) {
      const joinedCount = (joinWaitCounts.get(nodeId) || 0) + 1
      if (joinedCount < incomingCount) {
        joinWaitCounts.set(nodeId, joinedCount)
        return
      }
      joinWaitCounts.set(nodeId, 0)
      pushTokenOnFlow(outgoing[0], carryDistance)
      return
    }

    const routedOutgoing = getGatewayDispatchFlowIds(node, outgoing)
    for (const flowId of routedOutgoing) {
      pushTokenOnFlow(flowId, carryDistance)
    }
  }

  for (const token of tokens) {
    const geometry = flowGraph.flowsById.get(token.flowId)
    if (!geometry) {
      continue
    }

    const nextDistance = token.distance + distanceStep
    if (nextDistance < geometry.totalLength) {
      nextTokens.push({ flowId: token.flowId, distance: nextDistance })
      continue
    }

    arrivalQueue.push({ nodeId: geometry.targetRef, carryDistance: nextDistance - geometry.totalLength })
  }

  while (arrivalQueue.length) {
    const nextArrival = arrivalQueue.shift()
    if (!nextArrival) {
      continue
    }
    dispatchFromNode(nextArrival.nodeId, nextArrival.carryDistance)
  }

  return nextTokens
}

function getGatewayMarkerType(item) {
  const gatewayTypeValue = String(item.gatewayForkType || item.forkType || item.type || '').toLowerCase()

  if (gatewayTypeValue.includes('exclusivegateway') || gatewayTypeValue === 'exclusive') {
    return 'exclusive'
  }

  if (gatewayTypeValue.includes('inclusivegateway') || gatewayTypeValue === 'inclusive') {
    return 'inclusive'
  }

  if (gatewayTypeValue.includes('parallelgateway') || gatewayTypeValue === 'parallel') {
    return 'parallel'
  }

  if (gatewayTypeValue.includes('eventbasedgateway') || gatewayTypeValue === 'eventbased') {
    return 'eventbased'
  }

  if (gatewayTypeValue.includes('complexgateway') || gatewayTypeValue === 'complex') {
    return 'complex'
  }

  return 'unknown'
}

function drawGatewayMarker(ctx, item, x, y, width, height) {
  const markerType = getGatewayMarkerType(item)
  const centerX = x + width / 2
  const centerY = y + height / 2
  const markerSize = Math.max(6, Math.min(width, height) * 0.22)

  ctx.save()
  ctx.strokeStyle = '#2563eb'
  ctx.fillStyle = '#2563eb'
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.06)
  ctx.lineCap = 'round'

  if (markerType === 'exclusive') {
    ctx.beginPath()
    ctx.moveTo(centerX - markerSize, centerY - markerSize)
    ctx.lineTo(centerX + markerSize, centerY + markerSize)
    ctx.moveTo(centerX + markerSize, centerY - markerSize)
    ctx.lineTo(centerX - markerSize, centerY + markerSize)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (markerType === 'parallel') {
    ctx.beginPath()
    ctx.moveTo(centerX - markerSize, centerY)
    ctx.lineTo(centerX + markerSize, centerY)
    ctx.moveTo(centerX, centerY - markerSize)
    ctx.lineTo(centerX, centerY + markerSize)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (markerType === 'inclusive') {
    ctx.beginPath()
    ctx.arc(centerX, centerY, markerSize, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (markerType === 'eventbased') {
    const outerRadius = markerSize
    const innerRadius = markerSize * 0.7
    ctx.beginPath()
    ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2)
    ctx.stroke()

    const points = 5
    const starOuter = markerSize * 0.55
    const starInner = starOuter * 0.5
    ctx.beginPath()
    for (let i = 0; i < points * 2; i += 1) {
      const angle = -Math.PI / 2 + (Math.PI / points) * i
      const radius = i % 2 === 0 ? starOuter : starInner
      const px = centerX + Math.cos(angle) * radius
      const py = centerY + Math.sin(angle) * radius
      if (i === 0) {
        ctx.moveTo(px, py)
      } else {
        ctx.lineTo(px, py)
      }
    }
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
    return
  }

  if (markerType === 'complex') {
    const spokes = 8
    ctx.beginPath()
    for (let i = 0; i < spokes; i += 1) {
      const angle = (Math.PI * 2 * i) / spokes
      const x1 = centerX + Math.cos(angle) * markerSize
      const y1 = centerY + Math.sin(angle) * markerSize
      const x2 = centerX - Math.cos(angle) * markerSize
      const y2 = centerY - Math.sin(angle) * markerSize
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
    }
    ctx.stroke()
    ctx.restore()
    return
  }

  ctx.beginPath()
  ctx.arc(centerX, centerY, Math.max(3, markerSize * 0.25), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawGatewayName(ctx, item, x, y, width, height) {
  const name = String(item.name || '').trim()
  if (!name) {
    return
  }

  const isFork = name.toLowerCase().includes('fork')
  ctx.save()
  ctx.fillStyle = isFork ? '#2563eb' : '#111827'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = '600 11px Arial, sans-serif'
  ctx.fillText(name, x + width / 2, y + height + 6)
  ctx.restore()
}

function GatewayLegendIcon({ markerType }) {
  return (
    <svg className="gateway-legend-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polygon points="12,2 22,12 12,22 2,12" fill="none" stroke="currentColor" strokeWidth="1.8" />

      {markerType === 'exclusive' ? (
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="8" y1="8" x2="16" y2="16" />
          <line x1="16" y1="8" x2="8" y2="16" />
        </g>
      ) : null}

      {markerType === 'parallel' ? (
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="7.5" y1="12" x2="16.5" y2="12" />
          <line x1="12" y1="7.5" x2="12" y2="16.5" />
        </g>
      ) : null}

      {markerType === 'inclusive' ? <circle cx="12" cy="12" r="4.3" fill="none" stroke="currentColor" strokeWidth="2" /> : null}

      {markerType === 'eventbased' ? (
        <g fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="5.5" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3.8" strokeWidth="1.7" />
          <path d="M12 8.5l1.2 2.2 2.5.4-1.8 1.8.4 2.5L12 14.3l-2.3 1.1.4-2.5-1.8-1.8 2.5-.4z" strokeWidth="1.2" />
        </g>
      ) : null}

      {markerType === 'complex' ? (
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="12" y1="6.7" x2="12" y2="17.3" />
          <line x1="6.7" y1="12" x2="17.3" y2="12" />
          <line x1="8.2" y1="8.2" x2="15.8" y2="15.8" />
          <line x1="15.8" y1="8.2" x2="8.2" y2="15.8" />
        </g>
      ) : null}
    </svg>
  )
}

function getDisplayName(item, flowStatsByNodeId) {
  const baseName = item.name || item.id || ''

  if (item.type === 'event') {
    const stats = flowStatsByNodeId.get(String(item.id || '')) || { incoming: 0, outgoing: 0 }
    if (stats.incoming > 0 && stats.outgoing === 0) {
      return 'End'
    }
  }

  if (item.shape !== 'diamond') {
    return baseName
  }

  return baseName || 'Gateway'
}

function drawDiagram(
  ctx,
  items,
  bounds,
  selectedTaskId,
  notes = [],
  backgroundColor = '#ffffff',
  notesCollapsed = false,
  animatedFlowDots = []
) {
  const { canvasWidth, canvasHeight, offsetX, offsetY } = bounds

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  const flows = items.filter((item) => item.shape === 'line')
  const shapes = items.filter((item) => item.shape !== 'line')
  const flowStatsByNodeId = new Map()

  const ensureStats = (nodeId) => {
    const key = String(nodeId || '')
    if (!flowStatsByNodeId.has(key)) {
      flowStatsByNodeId.set(key, { incoming: 0, outgoing: 0 })
    }
    return flowStatsByNodeId.get(key)
  }

  for (const flow of flows) {
    const sourceStats = ensureStats(flow.sourceRef)
    sourceStats.outgoing += 1
    const targetStats = ensureStats(flow.targetRef)
    targetStats.incoming += 1
  }

  for (const flow of flows) {
    const waypoints = Array.isArray(flow.waypoints) ? flow.waypoints : []
    if (!waypoints.length) {
      continue
    }

    ctx.save()
    ctx.beginPath()
    ctx.strokeStyle = flow.color || '#2563eb'
    ctx.lineWidth = 2

    for (let i = 0; i < waypoints.length; i += 1) {
      const x = (waypoints[i]?.x ?? 0) + offsetX
      const y = (waypoints[i]?.y ?? 0) + offsetY
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }

    ctx.stroke()
    ctx.restore()

    if (waypoints.length >= 2) {
      const secondLast = waypoints[waypoints.length - 2]
      const last = waypoints[waypoints.length - 1]
      const fromX = (secondLast?.x ?? 0) + offsetX
      const fromY = (secondLast?.y ?? 0) + offsetY
      const toX = (last?.x ?? 0) + offsetX
      const toY = (last?.y ?? 0) + offsetY
      drawArrowHead(ctx, fromX, fromY, toX, toY, flow.color || '#2563eb')
    }
  }

  for (const item of shapes) {
    const x = (parseNumber(item.x) ?? 0) + offsetX
    const y = (parseNumber(item.y) ?? 0) + offsetY
    const width = parseNumber(item.width) ?? 0
    const height = parseNumber(item.height) ?? 0
    const hasSubProcessLink = item.type === 'task' && getNormalizedSubProcessFileNames(item).length > 0
    const isSelectedTask = item.type === 'task' && item.id === selectedTaskId
    const hasTaskErrors = item.type === 'task' && Array.isArray(item.errors) && item.errors.some((entry) => entry && typeof entry === 'object')
    const color = hasTaskErrors ? '#dc2626' : isSelectedTask ? '#60a5fa' : item.color || '#1f2937'
    const label = getDisplayName(item, flowStatsByNodeId)

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = isSelectedTask ? 3 : hasSubProcessLink ? 4 : 2

    if (isSelectedTask) {
      ctx.fillStyle = '#dbeafe'
      ctx.fillRect(x, y, width, height)
    }

    if (item.shape === 'rectangle') {
      ctx.strokeRect(x, y, width, height)
    } else if (item.shape === 'circle') {
      const radius = Math.max(1, Math.min(width, height) / 2)
      ctx.beginPath()
      ctx.arc(x + width / 2, y + height / 2, radius, 0, Math.PI * 2)
      ctx.stroke()
    } else if (item.shape === 'diamond') {
      const centerX = x + width / 2
      const centerY = y + height / 2
      ctx.beginPath()
      ctx.moveTo(centerX, y)
      ctx.lineTo(x + width, centerY)
      ctx.lineTo(centerX, y + height)
      ctx.lineTo(x, centerY)
      ctx.closePath()
      ctx.stroke()
    }

    ctx.fillStyle = '#111827'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '12px Arial, sans-serif'

    if (item.type === 'lane') {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(label, x + 8, y + 8)
    } else if (item.shape === 'diamond') {
      drawGatewayMarker(ctx, item, x, y, width, height)
      drawGatewayName(ctx, item, x, y, width, height)
    } else {
      drawMultilineCenteredText(ctx, label, x + width / 2, y + height / 2, Math.max(24, width - 8), 14)
    }

    ctx.restore()
  }

  for (const note of notes) {
    const x = (parseNumber(note.x) ?? 0) + offsetX
    const y = (parseNumber(note.y) ?? 0) + offsetY
    const width = getRenderedNoteWidth(note, notesCollapsed)
    const height = getRenderedNoteHeight(note, notesCollapsed)

    ctx.save()
    ctx.fillStyle = getNoteColor(note)
    ctx.strokeStyle = '#ca8a04'
    ctx.lineWidth = 1.5
    ctx.fillRect(x, y, width, height)
    ctx.strokeRect(x, y, width, height)

    const foldSize = Math.max(10, Math.min(16, Math.floor(Math.min(width, height) * 0.25)))
    ctx.beginPath()
    ctx.moveTo(x + width - foldSize, y)
    ctx.lineTo(x + width, y + foldSize)
    ctx.lineTo(x + width - foldSize, y + foldSize)
    ctx.closePath()
    ctx.fillStyle = '#fde047'
    ctx.fill()
    ctx.strokeStyle = '#ca8a04'
    ctx.stroke()

    ctx.fillStyle = '#1f2937'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    if (notesCollapsed) {
      ctx.font = '700 12px Arial, sans-serif'
      ctx.fillText('…', x + Math.max(6, width / 2 - 4), y + Math.max(4, height / 2 - 8))
    } else {
      const textAreaWidth = Math.max(40, width - 16)
      const textAreaHeight = Math.max(24, height - 16)
      const fittedText = getFittedNoteText(ctx, note.text || '', textAreaWidth, textAreaHeight)
      ctx.font = `${fittedText.fontSize}px Arial, sans-serif`

      for (let lineIndex = 0; lineIndex < fittedText.lines.length; lineIndex += 1) {
        const line = fittedText.lines[lineIndex]
        ctx.fillText(line, x + 8, y + 8 + lineIndex * fittedText.lineHeight)
      }

      ctx.strokeStyle = '#a16207'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + width - NOTE_RESIZE_HANDLE_SIZE, y + height)
      ctx.lineTo(x + width, y + height - NOTE_RESIZE_HANDLE_SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + width - NOTE_RESIZE_HANDLE_SIZE + 4, y + height)
      ctx.lineTo(x + width, y + height - NOTE_RESIZE_HANDLE_SIZE + 4)
      ctx.stroke()
    }

    ctx.restore()
  }

  for (const dot of animatedFlowDots) {
    const dotX = dot.x + offsetX
    const dotY = dot.y + offsetY
    ctx.save()
    ctx.fillStyle = '#ef4444'
    ctx.shadowColor = 'rgba(239, 68, 68, 0.75)'
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(dotX, dotY, FLOW_DOT_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

function normalizeNotes(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((note) => note && typeof note === 'object')
    .map((note) => ({
      id: typeof note.id === 'string' && note.id.trim() ? note.id : `note-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      x: parseNumber(note.x) ?? 0,
      y: parseNumber(note.y) ?? 0,
      width: getNoteWidth(note),
      height: getNoteHeight(note),
      color: getNoteColor(note),
      text: typeof note.text === 'string' ? note.text : '',
    }))
}

function normalizeDiagramPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      notes: [],
    }
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.diagram)) {
    return {
      items: payload.diagram,
      notes: normalizeNotes(payload.notes),
    }
  }

  throw new Error('JSON must be an array of diagram objects or an object with a diagram array.')
}

function serializeDiagramPayload(items, notes) {
  if (!Array.isArray(notes) || !notes.length) {
    return items
  }

  return {
    diagram: items,
    notes: notes.map((note) => ({
      id: note.id,
      x: note.x,
      y: note.y,
      width: getNoteWidth(note),
      height: getNoteHeight(note),
      color: getNoteColor(note),
      text: note.text,
    })),
  }
}

async function parseDiagramFile(file) {
  const text = await file.text()
  const parsed = JSON.parse(text)
  return normalizeDiagramPayload(parsed)
}

function createTab(title, fileName, items, parentTabId = null) {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title,
    fileName,
    items,
    parentTabId,
  }
}

function normalizeDiagramReference(fileName) {
  if (typeof fileName !== 'string') {
    return ''
  }

  const trimmedReference = fileName.trim().replace(/^["']+|["']+$/g, '')
  if (!trimmedReference) {
    return ''
  }

  return trimmedReference.replace(/\\/g, '/').trim()
}

function getDiagramBaseName(fileReference) {
  const normalizedReference = normalizeDiagramReference(fileReference)
  if (!normalizedReference) {
    return ''
  }

  return normalizedReference.split('/').pop()?.trim() || ''
}

function getDiagramReferenceKey(fileReference) {
  return normalizeDiagramReference(fileReference).toLowerCase()
}

function getNormalizedSubProcessFileNames(taskLike) {
  if (!taskLike || typeof taskLike !== 'object') {
    return []
  }

  const names = []

  if (typeof taskLike.subProcessFileName === 'string' && taskLike.subProcessFileName.trim()) {
    const normalizedSingle = normalizeDiagramReference(taskLike.subProcessFileName)
    if (normalizedSingle) {
      names.push(normalizedSingle)
    }
  }

  if (Array.isArray(taskLike.subProcessFileNames)) {
    for (const fileName of taskLike.subProcessFileNames) {
      const normalized = normalizeDiagramReference(fileName)
      if (normalized && !names.some((name) => getDiagramReferenceKey(name) === getDiagramReferenceKey(normalized))) {
        names.push(normalized)
      }
    }
  }

  return names
}

function formatDiagramTitle(fileName, fallback = 'Diagram') {
  const normalizedFileName = getDiagramBaseName(fileName)
  if (!normalizedFileName) {
    return fallback
  }

  return normalizedFileName.replace(/\.json$/i, '').replace(/_BPMN2\.0.*$/i, '').trim() || fallback
}

function getTabTree(tabs) {
  const childrenByParent = new Map()
  const tabById = new Map()

  for (const tab of tabs) {
    tabById.set(tab.id, tab)
    const parentKey = tab.parentTabId || '__root__'
    if (!childrenByParent.has(parentKey)) {
      childrenByParent.set(parentKey, [])
    }
    childrenByParent.get(parentKey).push(tab)
  }

  const included = new Set()

  const createNode = (tab, ancestry = new Set()) => {
    if (ancestry.has(tab.id)) {
      return { tab, children: [] }
    }

    included.add(tab.id)
    const nextAncestry = new Set(ancestry)
    nextAncestry.add(tab.id)

    const childTabs = childrenByParent.get(tab.id) || []
    const children = childTabs.map((child) => createNode(child, nextAncestry))

    return { tab, children }
  }

  const rootTabs = tabs.filter((tab) => !tab.parentTabId || !tabById.has(tab.parentTabId))
  const roots = rootTabs.map((rootTab) => createNode(rootTab))

  for (const tab of tabs) {
    if (!included.has(tab.id)) {
      roots.push(createNode(tab))
    }
  }

  return roots
}

async function loadDiagramFromProjectOutput(fileReference) {
  const normalizedReference = normalizeDiagramReference(fileReference)
  if (!normalizedReference) {
    return null
  }

  let response

  try {
    response = await fetch('/api/load-diagram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath: normalizedReference }),
    })
  } catch {
    response = null
  }

  // Keep backward compatibility with basename-based loading if API is unavailable.
  if (!response || !response.ok) {
    const baseName = getDiagramBaseName(normalizedReference)
    if (!baseName) {
      return null
    }
    try {
      response = await fetch(`/output/xml2json/${encodeURIComponent(baseName)}`)
    } catch {
      return null
    }
    if (!response.ok) {
      return null
    }
  }

  let parsed
  try {
    parsed = await response.json()
  } catch {
    return null
  }

  const payload = parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'payload')
    ? parsed.payload
    : parsed

  try {
    return normalizeDiagramPayload(payload)
  } catch {
    return null
  }
}

function getSubProcessFileNames(items) {
  const fileNames = new Set()

  for (const item of items) {
    const subProcesses = getNormalizedSubProcessFileNames(item)
    for (const fileName of subProcesses) {
      fileNames.add(fileName)
    }
  }

  return Array.from(fileNames)
}

function getInitialLeftPanelPercent() {
  if (typeof window === 'undefined') {
    return 20
  }

  const storedValue = window.localStorage.getItem(LEFT_PANEL_PERCENT_STORAGE_KEY)
  const parsedValue = Number.parseFloat(storedValue ?? '')
  if (!Number.isFinite(parsedValue)) {
    return 20
  }

  return Math.min(MAX_LEFT_PANEL_PERCENT, Math.max(MIN_LEFT_PANEL_PERCENT, parsedValue))
}

async function prebuildTabHierarchy(rootFileName, rootItems, rootNotes = []) {
  const tabs = []
  const tabsByReference = new Map()
  const notesByTabId = {}

  const traverse = async (fileName, items, notes = [], parentTabId = null) => {
    const fileReferenceKey = getDiagramReferenceKey(fileName)
    if (fileReferenceKey && tabsByReference.has(fileReferenceKey)) {
      return tabsByReference.get(fileReferenceKey)
    }

    const tab = createTab(formatDiagramTitle(fileName), fileName, items, parentTabId)
    tabs.push(tab)
    if (fileReferenceKey) {
      tabsByReference.set(fileReferenceKey, tab)
    }
    notesByTabId[tab.id] = normalizeNotes(notes)

    const childFileNames = getSubProcessFileNames(items)
    for (const childFileName of childFileNames) {
      const childKey = getDiagramReferenceKey(childFileName)
      if (childKey && tabsByReference.has(childKey)) {
        continue
      }

      const childPayload = await loadDiagramFromProjectOutput(childFileName)
      if (!childPayload) {
        continue
      }

      await traverse(childFileName, childPayload.items, childPayload.notes, tab.id)
    }

    return tab
  }

  const rootTab = await traverse(rootFileName, rootItems, rootNotes, null)

  return {
    tabs,
    rootTabId: rootTab?.id || '',
    notesByTabId,
  }
}

function App() {
  const [tabs, setTabs] = useState([])
  const [activeTabId, setActiveTabId] = useState('')
  const [error, setError] = useState('')
  const [themeName, setThemeName] = useState('classic')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [leftPanelPercent, setLeftPanelPercent] = useState(() => getInitialLeftPanelPercent())
  const [notesCollapsed, setNotesCollapsed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isDraggingNote, setIsDraggingNote] = useState(false)
  const [isResizingNote, setIsResizingNote] = useState(false)
  const [isResizingPanels, setIsResizingPanels] = useState(false)
  const [notesByTabId, setNotesByTabId] = useState({})
  const [animatedFlowDots, setAnimatedFlowDots] = useState([])
  const [isFlowAnimationEnabled, setIsFlowAnimationEnabled] = useState(true)
  const [flowSpeedMultiplier, setFlowSpeedMultiplier] = useState(1)
  const [collapsedTabIds, setCollapsedTabIds] = useState(() => new Set())
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [hoverTaskId, setHoverTaskId] = useState('')
  const [hoverNoteId, setHoverNoteId] = useState('')
  const [hoverNoteResizeId, setHoverNoteResizeId] = useState('')
  const [noteDialogState, setNoteDialogState] = useState({
    open: false,
    x: 0,
    y: 0,
    noteId: '',
    diagramX: 0,
    diagramY: 0,
    color: NOTE_DEFAULT_COLOR,
    text: '',
  })
  const [taskMenuState, setTaskMenuState] = useState({
    open: false,
    x: 0,
    y: 0,
    taskId: '',
  })
  const [applicationsDialogState, setApplicationsDialogState] = useState({
    open: false,
    x: 0,
    y: 0,
    taskId: '',
    selectedApplication: '',
  })
  const [subProcessesDialogState, setSubProcessesDialogState] = useState({
    open: false,
    x: 0,
    y: 0,
    taskId: '',
    selectedSubProcess: '',
  })
  const [metricsDialogState, setMetricsDialogState] = useState({
    open: false,
    x: 0,
    y: 0,
    taskId: '',
    avgDuration: 'N/A',
  })
  const [outagesDialogState, setOutagesDialogState] = useState({
    open: false,
    x: 0,
    y: 0,
    taskId: '',
  })
  const [pinnedApplicationsDialogs, setPinnedApplicationsDialogs] = useState([])
  const [taskExpandTransition, setTaskExpandTransition] = useState(null)
  const canvasRef = useRef(null)
  const canvasWrapRef = useRef(null)
  const layoutRef = useRef(null)
  const panLastPointRef = useRef({ x: 0, y: 0 })
  const panVelocityRef = useRef({ x: 0, y: 0 })
  const panLastMoveTimeRef = useRef(0)
  const panAnimationFrameRef = useRef(0)
  const flowAnimationFrameRef = useRef(0)
  const taskExpandTimeoutRef = useRef(0)
  const panInitializedTabIdRef = useRef('')
  const panningTaskCandidateRef = useRef('')
  const panningMovedRef = useRef(false)
  const noteDragStateRef = useRef({
    noteId: '',
    startClientX: 0,
    startClientY: 0,
    startNoteX: 0,
    startNoteY: 0,
    moved: false,
  })
  const noteResizeStateRef = useRef({
    noteId: '',
    startClientX: 0,
    startClientY: 0,
    startNoteWidth: NOTE_WIDTH,
    startNoteHeight: NOTE_HEIGHT,
  })
  const applicationsDialogDragRef = useRef({
    dragging: false,
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
    dialogId: 'floating',
    isPinned: false,
  })

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) || tabs[0], [tabs, activeTabId])
  const activeItems = activeTab?.items || []
  const activeNotes = useMemo(() => notesByTabId[activeTab?.id] || [], [notesByTabId, activeTab])
  const tabTree = useMemo(() => getTabTree(tabs), [tabs])
  const flowAnimationGraph = useMemo(() => buildFlowAnimationGraph(activeItems), [activeItems])

  const bounds = useMemo(() => getBounds(activeItems, activeNotes, notesCollapsed), [activeItems, activeNotes, notesCollapsed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const dpr = window.devicePixelRatio || 1
    const scaledCanvasWidth = bounds.canvasWidth * zoomLevel
    const scaledCanvasHeight = bounds.canvasHeight * zoomLevel
    canvas.width = Math.max(1, Math.floor(scaledCanvasWidth * dpr))
    canvas.height = Math.max(1, Math.floor(scaledCanvasHeight * dpr))
    canvas.style.width = `${scaledCanvasWidth}px`
    canvas.style.height = `${scaledCanvasHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const wrapBackground = canvasWrapRef.current
      ? window.getComputedStyle(canvasWrapRef.current).backgroundColor
      : '#ffffff'

    ctx.setTransform(dpr * zoomLevel, 0, 0, dpr * zoomLevel, 0, 0)
    drawDiagram(ctx, activeItems, bounds, selectedTaskId, activeNotes, wrapBackground, notesCollapsed, animatedFlowDots)
  }, [activeItems, activeNotes, bounds, selectedTaskId, zoomLevel, themeName, notesCollapsed, animatedFlowDots])

  useEffect(() => {
    if (flowAnimationFrameRef.current) {
      window.cancelAnimationFrame(flowAnimationFrameRef.current)
      flowAnimationFrameRef.current = 0
    }

    if (!isFlowAnimationEnabled || !flowAnimationGraph.flowsById.size) {
      setAnimatedFlowDots((previousDots) => (previousDots.length ? [] : previousDots))
      return
    }

    let running = true
    let tokens = spawnInitialTokens(flowAnimationGraph)
    const joinWaitCounts = new Map()
    let idleMs = 0
    let lastTime = performance.now()

    const publishDots = () => {
      const dots = tokens
        .map((token) => {
          const geometry = flowAnimationGraph.flowsById.get(token.flowId)
          if (!geometry) {
            return null
          }
          return getPointOnFlow(geometry, token.distance)
        })
        .filter(Boolean)
      setAnimatedFlowDots(dots)
    }

    publishDots()

    const animate = (now) => {
      if (!running) {
        return
      }

      const deltaMs = Math.min(64, Math.max(0, now - lastTime))
      lastTime = now

      if (!tokens.length) {
        idleMs += deltaMs
        if (idleMs >= 900) {
          tokens = spawnInitialTokens(flowAnimationGraph)
          idleMs = 0
          joinWaitCounts.clear()
        }
      } else {
        const distanceStep = FLOW_DOT_SPEED * flowSpeedMultiplier * (deltaMs / 1000)
        tokens = advanceFlowTokens(tokens, flowAnimationGraph, distanceStep, joinWaitCounts)
      }

      publishDots()
      flowAnimationFrameRef.current = window.requestAnimationFrame(animate)
    }

    flowAnimationFrameRef.current = window.requestAnimationFrame(animate)

    return () => {
      running = false
      if (flowAnimationFrameRef.current) {
        window.cancelAnimationFrame(flowAnimationFrameRef.current)
        flowAnimationFrameRef.current = 0
      }
    }
  }, [flowAnimationGraph, isFlowAnimationEnabled, flowSpeedMultiplier])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    if (isResizingNote) {
      canvas.style.cursor = 'nwse-resize'
      return
    }

    if (isPanning || isDraggingNote) {
      canvas.style.cursor = 'grabbing'
      return
    }

    if (hoverTaskId) {
      canvas.style.cursor = 'pointer'
      return
    }

    if (hoverNoteResizeId) {
      canvas.style.cursor = 'nwse-resize'
      return
    }

    canvas.style.cursor = hoverNoteId ? 'grab' : 'grab'
  }, [hoverTaskId, hoverNoteId, hoverNoteResizeId, isDraggingNote, isPanning, isResizingNote])

  useEffect(() => {
    const stopPanning = () => {
      setIsPanning(false)
      setIsDraggingNote(false)
      setIsResizingNote(false)
    }

    window.addEventListener('mouseup', stopPanning)
    return () => {
      window.removeEventListener('mouseup', stopPanning)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (panAnimationFrameRef.current) {
        window.cancelAnimationFrame(panAnimationFrameRef.current)
        panAnimationFrameRef.current = 0
      }
      if (flowAnimationFrameRef.current) {
        window.cancelAnimationFrame(flowAnimationFrameRef.current)
        flowAnimationFrameRef.current = 0
      }
      if (taskExpandTimeoutRef.current) {
        window.clearTimeout(taskExpandTimeoutRef.current)
        taskExpandTimeoutRef.current = 0
      }
    }
  }, [])

  useEffect(() => {
    const onMouseMove = (event) => {
      if (!applicationsDialogDragRef.current.dragging || !applicationsDialogState.open) {
        return
      }

      const wrap = canvasWrapRef.current
      if (!wrap) {
        return
      }

      const deltaX = event.clientX - applicationsDialogDragRef.current.startClientX
      const deltaY = event.clientY - applicationsDialogDragRef.current.startClientY
      const nextX = applicationsDialogDragRef.current.startX + deltaX
      const nextY = applicationsDialogDragRef.current.startY + deltaY
      const clamped = clampOverlayPosition(wrap, nextX, nextY, APPLICATIONS_DIALOG_WIDTH, APPLICATIONS_DIALOG_HEIGHT)

      if (applicationsDialogDragRef.current.isPinned) {
        setPinnedApplicationsDialogs((previous) =>
          previous.map((dialog) =>
            dialog.id === applicationsDialogDragRef.current.dialogId
              ? {
                  ...dialog,
                  x: clamped.x,
                  y: clamped.y,
                }
              : dialog
          )
        )
      } else {
        setApplicationsDialogState((previous) => ({
          ...previous,
          x: clamped.x,
          y: clamped.y,
        }))
      }
    }

    const onMouseUp = () => {
      applicationsDialogDragRef.current.dragging = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [applicationsDialogState.open])

  useEffect(() => {
    if (!applicationsDialogState.open) {
      return undefined
    }

    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element)) {
        return
      }

      if (event.target.closest('.applications-dialog')) {
        return
      }

      setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
    }

    const handleWindowBlur = () => {
      setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
    }

    window.addEventListener('mousedown', handlePointerDown, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [applicationsDialogState.open])

  const runTaskExpandTransition = async (task, destinationItems, destinationNotes = []) => {
    const wrap = canvasWrapRef.current
    if (!wrap) {
      return
    }

    const taskX = ((parseNumber(task.x) ?? 0) + bounds.offsetX) * zoomLevel
    const taskY = ((parseNumber(task.y) ?? 0) + bounds.offsetY) * zoomLevel
    const taskWidth = Math.max(20, (parseNumber(task.width) ?? 100) * zoomLevel)
    const taskHeight = Math.max(20, (parseNumber(task.height) ?? 80) * zoomLevel)

    const destinationBounds = getBounds(destinationItems, destinationNotes, notesCollapsed)
    const endLeft = Math.max(8, destinationBounds.minX + destinationBounds.offsetX)
    const endTop = Math.max(8, destinationBounds.minY + destinationBounds.offsetY)
    const endWidth = Math.max(120, destinationBounds.width)
    const endHeight = Math.max(120, destinationBounds.height)

    setTaskExpandTransition({
      left: taskX,
      top: taskY,
      width: taskWidth,
      height: taskHeight,
      expanded: false,
    })

    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        setTaskExpandTransition({
          left: endLeft * zoomLevel,
          top: endTop * zoomLevel,
          width: endWidth * zoomLevel,
          height: endHeight * zoomLevel,
          expanded: true,
        })
        taskExpandTimeoutRef.current = window.setTimeout(() => {
          setTaskExpandTransition(null)
          taskExpandTimeoutRef.current = 0
          resolve()
        }, TASK_EXPAND_ANIMATION_MS)
      })
    })
  }

  useEffect(() => {
    if (!isResizingPanels) {
      return undefined
    }

    const onMouseMove = (event) => {
      const layout = layoutRef.current
      if (!layout) {
        return
      }

      const rect = layout.getBoundingClientRect()
      if (!rect.width) {
        return
      }

      const rawPercent = ((event.clientX - rect.left) / rect.width) * 100
      const clampedPercent = Math.min(MAX_LEFT_PANEL_PERCENT, Math.max(MIN_LEFT_PANEL_PERCENT, rawPercent))
      setLeftPanelPercent(clampedPercent)
    }

    const onMouseUp = () => {
      setIsResizingPanels(false)
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isResizingPanels])

  useEffect(() => {
    window.localStorage.setItem(LEFT_PANEL_PERCENT_STORAGE_KEY, leftPanelPercent.toFixed(2))
  }, [leftPanelPercent])

  useEffect(() => {
    const wrap = canvasWrapRef.current
    if (!wrap || !activeTabId || panInitializedTabIdRef.current === activeTabId) {
      return
    }

    panInitializedTabIdRef.current = activeTabId
    wrap.scrollLeft = EXTRA_PAN_SPACE_X_LEFT
    wrap.scrollTop = EXTRA_PAN_SPACE_Y_TOP
  }, [activeTabId])

  useEffect(() => {
    setSelectedTaskId('')
    setHoverTaskId('')
    setHoverNoteId('')
    setHoverNoteResizeId('')
    setIsDraggingNote(false)
    setIsResizingNote(false)
    panningTaskCandidateRef.current = ''
    panningMovedRef.current = false
    setNoteDialogState({ open: false, x: 0, y: 0, noteId: '', diagramX: 0, diagramY: 0, color: NOTE_DEFAULT_COLOR, text: '' })
    setTaskMenuState({ open: false, x: 0, y: 0, taskId: '' })
    setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
    setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
    setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
    setOutagesDialogState({ open: false, x: 0, y: 0, taskId: '' })
    setPinnedApplicationsDialogs([])
  }, [activeTabId])

  const onCloseTab = (tabIdToClose) => {
    setTabs((previousTabs) => {
      const closedTabIndex = previousTabs.findIndex((tab) => tab.id === tabIdToClose)
      if (closedTabIndex === -1) {
        return previousTabs
      }

      const remainingTabs = previousTabs.filter((tab) => tab.id !== tabIdToClose)

      if (activeTabId === tabIdToClose) {
        setActiveTabId(remainingTabs[0]?.id || '')
      }

      setCollapsedTabIds((previousCollapsed) => {
        const remainingTabIds = new Set(remainingTabs.map((tab) => tab.id))
        const nextCollapsed = new Set()
        for (const tabId of previousCollapsed) {
          if (remainingTabIds.has(tabId)) {
            nextCollapsed.add(tabId)
          }
        }
        return nextCollapsed
      })

      setNotesByTabId((previousNotesByTabId) => {
        if (!Object.prototype.hasOwnProperty.call(previousNotesByTabId, tabIdToClose)) {
          return previousNotesByTabId
        }

        const nextNotesByTabId = { ...previousNotesByTabId }
        delete nextNotesByTabId[tabIdToClose]
        return nextNotesByTabId
      })

      return remainingTabs
    })
  }

  const onToggleCollapsed = (tabId) => {
    setCollapsedTabIds((previous) => {
      const next = new Set(previous)
      if (next.has(tabId)) {
        next.delete(tabId)
      } else {
        next.add(tabId)
      }
      return next
    })
  }

  const onFileSelected = async (event) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      return
    }

    try {
      const parsedPayload = await parseDiagramFile(selectedFile)
      const { tabs: prebuiltTabs, rootTabId, notesByTabId: prebuiltNotesByTabId } = await prebuildTabHierarchy(
        selectedFile.name,
        parsedPayload.items,
        parsedPayload.notes
      )
      setTabs(prebuiltTabs)
      setActiveTabId(rootTabId || prebuiltTabs[0]?.id || '')
      setCollapsedTabIds(new Set())
      setError('')
      setSelectedTaskId('')
      setHoverTaskId('')
      setNotesByTabId(prebuiltNotesByTabId)
      setNoteDialogState({ open: false, x: 0, y: 0, noteId: '', diagramX: 0, diagramY: 0, color: NOTE_DEFAULT_COLOR, text: '' })
      setTaskMenuState({ open: false, x: 0, y: 0, taskId: '' })
      setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
      setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
      setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
      setPinnedApplicationsDialogs([])
    } catch (fileError) {
      setTabs([])
      setActiveTabId('')
      setCollapsedTabIds(new Set())
      setError(fileError instanceof Error ? fileError.message : 'Unable to load JSON file.')
      setSelectedTaskId('')
      setHoverTaskId('')
      setNotesByTabId({})
      setNoteDialogState({ open: false, x: 0, y: 0, noteId: '', diagramX: 0, diagramY: 0, color: NOTE_DEFAULT_COLOR, text: '' })
      setTaskMenuState({ open: false, x: 0, y: 0, taskId: '' })
      setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
      setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
      setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
      setPinnedApplicationsDialogs([])
    }

    event.target.value = ''
  }

  const onCanvasMouseMove = (event) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    if (isDraggingNote) {
      const tabId = activeTab?.id
      if (!tabId || !noteDragStateRef.current.noteId) {
        return
      }

      const deltaClientX = event.clientX - noteDragStateRef.current.startClientX
      const deltaClientY = event.clientY - noteDragStateRef.current.startClientY
      const deltaDiagramX = deltaClientX / zoomLevel
      const deltaDiagramY = deltaClientY / zoomLevel

      if (Math.abs(deltaClientX) > 3 || Math.abs(deltaClientY) > 3) {
        noteDragStateRef.current.moved = true
      }

      setNotesByTabId((previousNotesByTabId) => {
        const existingNotes = previousNotesByTabId[tabId] || []
        return {
          ...previousNotesByTabId,
          [tabId]: existingNotes.map((note) =>
            note.id === noteDragStateRef.current.noteId
              ? {
                  ...note,
                  x: noteDragStateRef.current.startNoteX + deltaDiagramX,
                  y: noteDragStateRef.current.startNoteY + deltaDiagramY,
                }
              : note
          ),
        }
      })

      return
    }

    if (isResizingNote) {
      const tabId = activeTab?.id
      if (!tabId || !noteResizeStateRef.current.noteId) {
        return
      }

      const deltaClientX = event.clientX - noteResizeStateRef.current.startClientX
      const deltaClientY = event.clientY - noteResizeStateRef.current.startClientY
      const deltaDiagramX = deltaClientX / zoomLevel
      const deltaDiagramY = deltaClientY / zoomLevel
      const nextWidth = Math.max(NOTE_MIN_WIDTH, noteResizeStateRef.current.startNoteWidth + deltaDiagramX)
      const nextHeight = Math.max(NOTE_MIN_HEIGHT, noteResizeStateRef.current.startNoteHeight + deltaDiagramY)

      setNotesByTabId((previousNotesByTabId) => {
        const existingNotes = previousNotesByTabId[tabId] || []
        return {
          ...previousNotesByTabId,
          [tabId]: existingNotes.map((note) =>
            note.id === noteResizeStateRef.current.noteId
              ? {
                  ...note,
                  width: nextWidth,
                  height: nextHeight,
                }
              : note
          ),
        }
      })

      return
    }

    if (isPanning) {
      const wrap = canvasWrapRef.current
      if (!wrap) {
        return
      }

      const now = performance.now()
      const elapsed = Math.max(1, now - panLastMoveTimeRef.current)
      const deltaX = event.clientX - panLastPointRef.current.x
      const deltaY = event.clientY - panLastPointRef.current.y
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        panningMovedRef.current = true
      }
      wrap.scrollLeft -= deltaX
      wrap.scrollTop -= deltaY

      panVelocityRef.current = {
        x: deltaX / elapsed,
        y: deltaY / elapsed,
      }
      panLastPointRef.current = { x: event.clientX, y: event.clientY }
      panLastMoveTimeRef.current = now
      setHoverTaskId('')
      return
    }

    const point = getCanvasPoint(event, canvas, zoomLevel)
    const note = findNoteAtPoint(activeNotes, bounds, point.x, point.y, notesCollapsed)
    if (note) {
      const resizeTarget = findNoteResizeHandleAtPoint(activeNotes, bounds, point.x, point.y, notesCollapsed)
      setHoverNoteResizeId(resizeTarget?.id || '')
      setHoverNoteId(note.id)
      setHoverTaskId('')
      return
    }

    setHoverNoteId('')
    setHoverNoteResizeId('')
    const task = findTaskAtPoint(activeItems, bounds, point.x, point.y)
    setHoverTaskId(task?.id || '')
  }

  const onCanvasMouseDown = (event) => {
    if (event.button !== 0) {
      return
    }

    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    setTaskMenuState({ open: false, x: 0, y: 0, taskId: '' })
    setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
    setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
    setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
    if (noteDialogState.open) {
      setNoteDialogState((previous) => ({ ...previous, open: false }))
    }
    setIsResizingNote(false)
    noteResizeStateRef.current = {
      noteId: '',
      startClientX: 0,
      startClientY: 0,
      startNoteWidth: NOTE_WIDTH,
      startNoteHeight: NOTE_HEIGHT,
    }

    const point = getCanvasPoint(event, canvas, zoomLevel)
    const resizeNote = findNoteResizeHandleAtPoint(activeNotes, bounds, point.x, point.y, notesCollapsed)
    if (resizeNote) {
      noteResizeStateRef.current = {
        noteId: resizeNote.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startNoteWidth: getNoteWidth(resizeNote),
        startNoteHeight: getNoteHeight(resizeNote),
      }
      setIsResizingNote(true)
      setIsDraggingNote(false)
      setIsPanning(false)
      return
    }

    const note = findNoteAtPoint(activeNotes, bounds, point.x, point.y, notesCollapsed)
    if (note) {
      noteDragStateRef.current = {
        noteId: note.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startNoteX: note.x,
        startNoteY: note.y,
        moved: false,
      }
      setIsDraggingNote(true)
      setIsPanning(false)
      return
    }

    const task = findTaskAtPoint(activeItems, bounds, point.x, point.y)
    if (!task) {
      setSelectedTaskId('')
      panningTaskCandidateRef.current = ''
    } else {
      panningTaskCandidateRef.current = task.id
    }

    panningMovedRef.current = false
    panLastPointRef.current = { x: event.clientX, y: event.clientY }
    panLastMoveTimeRef.current = performance.now()
    panVelocityRef.current = { x: 0, y: 0 }
    if (panAnimationFrameRef.current) {
      window.cancelAnimationFrame(panAnimationFrameRef.current)
      panAnimationFrameRef.current = 0
    }
    setIsPanning(true)
  }

  const handleCanvasContextMenu = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (event.target instanceof Element && event.target.closest('.note-dialog, .task-menu, .metrics-dialog')) {
      return
    }

    setIsPanning(false)
    setIsDraggingNote(false)
    setIsResizingNote(false)
    panningTaskCandidateRef.current = ''
    panningMovedRef.current = false
    if (panAnimationFrameRef.current) {
      window.cancelAnimationFrame(panAnimationFrameRef.current)
      panAnimationFrameRef.current = 0
    }

    const canvas = canvasRef.current
    const wrap = canvasWrapRef.current
    if (!canvas || !wrap) {
      return
    }

    const point = getCanvasPoint(event, canvas, zoomLevel)
    const taskMenuPosition = getOverlayPosition(wrap, event.clientX, event.clientY, 240, 120)
    const noteDialogPosition = getOverlayPosition(wrap, event.clientX, event.clientY, 280, 220)
    const task = findTaskAtPoint(activeItems, bounds, point.x, point.y)

    if (task) {
      setSelectedTaskId(task.id)
      setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
      setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
      setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
      setOutagesDialogState({ open: false, x: 0, y: 0, taskId: '' })
      setNoteDialogState((previous) => ({ ...previous, open: false }))
      setTaskMenuState({
        open: true,
        x: taskMenuPosition.x,
        y: taskMenuPosition.y,
        taskId: task.id,
      })
      return
    }

    const note = findNoteAtPoint(activeNotes, bounds, point.x, point.y, notesCollapsed)

    setTaskMenuState({ open: false, x: 0, y: 0, taskId: '' })
    setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
    setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
    setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
    setOutagesDialogState({ open: false, x: 0, y: 0, taskId: '' })

    if (note) {
      setNoteDialogState({
        open: true,
        x: noteDialogPosition.x,
        y: noteDialogPosition.y,
        noteId: note.id,
        diagramX: note.x,
        diagramY: note.y,
        color: getNoteColor(note),
        text: note.text || '',
      })
      return
    }

    setNoteDialogState({
      open: true,
      x: noteDialogPosition.x,
      y: noteDialogPosition.y,
      noteId: '',
      diagramX: point.x - bounds.offsetX,
      diagramY: point.y - bounds.offsetY,
      color: NOTE_DEFAULT_COLOR,
      text: '',
    })
  }

  const onCanvasContextMenu = (event) => {
    handleCanvasContextMenu(event)
  }

  const onCanvasWrapContextMenu = (event) => {
    handleCanvasContextMenu(event)
  }

  useEffect(() => {
    const wrap = canvasWrapRef.current
    if (!wrap) {
      return undefined
    }

    const nativeContextHandler = (event) => {
      handleCanvasContextMenu(event)
    }

    wrap.addEventListener('contextmenu', nativeContextHandler, true)
    return () => {
      wrap.removeEventListener('contextmenu', nativeContextHandler, true)
    }
  }, [handleCanvasContextMenu])

  const onDialogOptionClick = (option) => {
    const taskId = taskMenuState.taskId
    if (taskId) {
      setSelectedTaskId(taskId)

      if (option === 'Applications') {
        const wrap = canvasWrapRef.current
        if (wrap) {
          const task = activeItems.find((item) => item.id === taskId)
          const taskX = ((parseNumber(task?.x) ?? 0) + bounds.offsetX) * zoomLevel
          const taskY = ((parseNumber(task?.y) ?? 0) + bounds.offsetY) * zoomLevel
          const taskWidth = (parseNumber(task?.width) ?? 100) * zoomLevel
          const desiredX = taskX + taskWidth + 12
          const desiredY = taskY - 8
          const dialogPosition = clampOverlayPosition(
            wrap,
            desiredX,
            desiredY,
            APPLICATIONS_DIALOG_WIDTH,
            APPLICATIONS_DIALOG_HEIGHT
          )
          const applications = Array.isArray(task?.applications)
            ? task.applications.filter((app) => typeof app === 'string' && app.trim())
            : []

          setApplicationsDialogState({
            open: true,
            x: dialogPosition.x,
            y: dialogPosition.y,
            taskId,
            selectedApplication: applications[0] || '',
          })
        }
      } else if (option === 'SubProcesses') {
        const wrap = canvasWrapRef.current
        if (wrap) {
          const task = activeItems.find((item) => item.id === taskId)
          const taskX = ((parseNumber(task?.x) ?? 0) + bounds.offsetX) * zoomLevel
          const taskY = ((parseNumber(task?.y) ?? 0) + bounds.offsetY) * zoomLevel
          const taskWidth = (parseNumber(task?.width) ?? 100) * zoomLevel
          const desiredX = taskX + taskWidth + 12
          const desiredY = taskY - 8
          const dialogPosition = clampOverlayPosition(
            wrap,
            desiredX,
            desiredY,
            SUBPROCESSES_DIALOG_WIDTH,
            SUBPROCESSES_DIALOG_HEIGHT
          )
          const subProcesses = getTaskSubProcesses(taskId)

          setSubProcessesDialogState({
            open: true,
            x: dialogPosition.x,
            y: dialogPosition.y,
            taskId,
            selectedSubProcess: subProcesses[0] || '',
          })
        }
      } else if (option === 'Metrics') {
        const wrap = canvasWrapRef.current
        if (wrap) {
          const task = activeItems.find((item) => item.id === taskId)
          const taskX = ((parseNumber(task?.x) ?? 0) + bounds.offsetX) * zoomLevel
          const taskY = ((parseNumber(task?.y) ?? 0) + bounds.offsetY) * zoomLevel
          const taskWidth = (parseNumber(task?.width) ?? 100) * zoomLevel
          const desiredX = taskX + taskWidth + 12
          const desiredY = taskY - 8
          const dialogPosition = clampOverlayPosition(
            wrap,
            desiredX,
            desiredY,
            METRICS_DIALOG_WIDTH,
            METRICS_DIALOG_HEIGHT
          )

          setMetricsDialogState({
            open: true,
            x: dialogPosition.x,
            y: dialogPosition.y,
            taskId,
            avgDuration: getTaskAvgDuration(task),
          })
        }
      } else if (option === 'Outages') {
        const wrap = canvasWrapRef.current
        if (wrap) {
          const task = activeItems.find((item) => item.id === taskId)
          const taskX = ((parseNumber(task?.x) ?? 0) + bounds.offsetX) * zoomLevel
          const taskY = ((parseNumber(task?.y) ?? 0) + bounds.offsetY) * zoomLevel
          const taskWidth = (parseNumber(task?.width) ?? 100) * zoomLevel
          const desiredX = taskX + taskWidth + 12
          const desiredY = taskY - 8
          const dialogPosition = clampOverlayPosition(
            wrap,
            desiredX,
            desiredY,
            OUTAGES_DIALOG_WIDTH,
            OUTAGES_DIALOG_HEIGHT
          )

          setOutagesDialogState({
            open: true,
            x: dialogPosition.x,
            y: dialogPosition.y,
            taskId,
          })
        }
      } else {
        setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
        setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
        setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
        setOutagesDialogState({ open: false, x: 0, y: 0, taskId: '' })
      }

      console.log(`Task ${taskId} option ${option}`)
    }
    setTaskMenuState({ open: false, x: 0, y: 0, taskId: '' })
  }

  const onCancelTaskMenu = () => {
    setTaskMenuState({ open: false, x: 0, y: 0, taskId: '' })
  }

  const onSelectSubProcess = (subProcessFileName) => {
    setSubProcessesDialogState((previous) => ({ ...previous, selectedSubProcess: subProcessFileName }))
  }

  const onCloseMetricsDialog = () => {
    setMetricsDialogState({ open: false, x: 0, y: 0, taskId: '', avgDuration: 'N/A' })
  }

  const onCloseOutagesDialog = () => {
    setOutagesDialogState({ open: false, x: 0, y: 0, taskId: '' })
  }

  const onLoadSubProcessDiagram = async (subProcessFileName) => {
    const normalizedSubProcessFileName = normalizeDiagramReference(subProcessFileName)
    if (!normalizedSubProcessFileName) {
      return
    }

    const subProcessReferenceKey = getDiagramReferenceKey(normalizedSubProcessFileName)

    const wrap = canvasWrapRef.current
    const triggerTask = activeItems.find((item) => item.id === subProcessesDialogState.taskId)

    setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
    setNoteDialogState((previous) => ({ ...previous, open: false }))

    // Resolve destination data before animating so we know the target bounds
    const existingTab = tabs.find((tab) => getDiagramReferenceKey(tab.fileName) === subProcessReferenceKey)
    let destinationItems
    let destinationNotes
    let newTab

    if (existingTab) {
      destinationItems = existingTab.items
      destinationNotes = notesByTabId[existingTab.id] || []
    } else {
      const parsedPayload = await loadDiagramFromProjectOutput(normalizedSubProcessFileName)
      if (!parsedPayload) {
        setError(`Failed to load subprocess: ${normalizedSubProcessFileName}`)
        return
      }
      const title = formatDiagramTitle(normalizedSubProcessFileName)
      newTab = createTab(title, normalizedSubProcessFileName, parsedPayload.items, activeTabId || null)
      destinationItems = parsedPayload.items
      destinationNotes = normalizeNotes(parsedPayload.notes)
    }

    if (triggerTask && wrap) {
      const taskX = ((parseNumber(triggerTask.x) ?? 0) + bounds.offsetX) * zoomLevel
      const taskY = ((parseNumber(triggerTask.y) ?? 0) + bounds.offsetY) * zoomLevel
      const taskWidth = Math.max(20, (parseNumber(triggerTask.width) ?? 100) * zoomLevel)
      const taskHeight = Math.max(20, (parseNumber(triggerTask.height) ?? 80) * zoomLevel)

      const destBounds = getBounds(destinationItems, destinationNotes, notesCollapsed)
      const endLeft = Math.max(8, destBounds.minX + destBounds.offsetX) * zoomLevel
      const endTop = Math.max(8, destBounds.minY + destBounds.offsetY) * zoomLevel
      const endWidth = Math.max(120, destBounds.width) * zoomLevel
      const endHeight = Math.max(120, destBounds.height) * zoomLevel

      if (taskExpandTimeoutRef.current) {
        window.clearTimeout(taskExpandTimeoutRef.current)
        taskExpandTimeoutRef.current = 0
      }

      setTaskExpandTransition({ left: taskX, top: taskY, width: taskWidth, height: taskHeight, expanded: false })

      await new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          setTaskExpandTransition({ left: endLeft, top: endTop, width: endWidth, height: endHeight, expanded: false })
          taskExpandTimeoutRef.current = window.setTimeout(resolve, TASK_EXPAND_ANIMATION_MS)
        })
      })
    }

    if (newTab) {
      setTabs((previousTabs) => [...previousTabs, newTab])
      setNotesByTabId((previousNotesByTabId) => ({ ...previousNotesByTabId, [newTab.id]: destinationNotes }))
      setActiveTabId(newTab.id)
    } else {
      setActiveTabId(existingTab.id)
    }
    setError('')

    if (triggerTask && wrap) {
      // expanded:true reveals the canvas (now showing new diagram) and starts fade-out
      setTaskExpandTransition((prev) => prev ? { ...prev, expanded: true } : null)
      taskExpandTimeoutRef.current = window.setTimeout(() => {
        setTaskExpandTransition(null)
        taskExpandTimeoutRef.current = 0
      }, TASK_EXPAND_ANIMATION_MS)
    }
  }

  const onCloseSubProcessesDialog = () => {
    setSubProcessesDialogState({ open: false, x: 0, y: 0, taskId: '', selectedSubProcess: '' })
  }

  const onSelectApplication = (applicationName, dialogId = 'floating', isPinned = false) => {
    if (isPinned) {
      setPinnedApplicationsDialogs((previous) =>
        previous.map((dialog) =>
          dialog.id === dialogId
            ? {
                ...dialog,
                selectedApplication: applicationName,
              }
            : dialog
        )
      )
      return
    }

    setApplicationsDialogState((previous) => ({ ...previous, selectedApplication: applicationName }))
  }

  const onApplicationsDialogMouseDown = (event, dialogId = 'floating', isPinned = false) => {
    if (event.button !== 0) {
      return
    }

    if (
      event.target instanceof Element
      && event.target.closest('button, input, textarea, select, option, a, [role="button"]')
    ) {
      return
    }

    const source = isPinned
      ? pinnedApplicationsDialogs.find((dialog) => dialog.id === dialogId)
      : applicationsDialogState
    if (!source) {
      return
    }

    applicationsDialogDragRef.current = {
      dragging: true,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: source.x,
      startY: source.y,
      dialogId,
      isPinned,
    }
  }

  const onCloseApplicationsDialog = (dialogId = 'floating', isPinned = false) => {
    if (isPinned) {
      setPinnedApplicationsDialogs((previous) => previous.filter((dialog) => dialog.id !== dialogId))
      return
    }

    setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
  }

  const onTogglePinApplicationsDialog = (dialogId = 'floating', isPinned = false) => {
    if (!isPinned) {
      if (!applicationsDialogState.open || !applicationsDialogState.taskId) {
        return
      }

      const pinId = `apps-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      setPinnedApplicationsDialogs((previous) => [
        ...previous,
        {
          id: pinId,
          x: applicationsDialogState.x,
          y: applicationsDialogState.y,
          taskId: applicationsDialogState.taskId,
          selectedApplication: applicationsDialogState.selectedApplication,
        },
      ])
      setApplicationsDialogState({ open: false, x: 0, y: 0, taskId: '', selectedApplication: '' })
      return
    }

    const targetDialog = pinnedApplicationsDialogs.find((dialog) => dialog.id === dialogId)
    if (!targetDialog) {
      return
    }

    setApplicationsDialogState({
      open: true,
      x: targetDialog.x,
      y: targetDialog.y,
      taskId: targetDialog.taskId,
      selectedApplication: targetDialog.selectedApplication,
    })
    setPinnedApplicationsDialogs((previous) => previous.filter((dialog) => dialog.id !== dialogId))
  }

  const getTaskApplications = (taskId) => {
    const task = activeItems.find((item) => item.id === taskId)
    const apps = task?.applications
    return Array.isArray(apps) ? apps.filter((app) => typeof app === 'string' && app.trim()) : []
  }

  const getTaskSubProcesses = (taskId) => {
    const task = activeItems.find((item) => item.id === taskId)
    return getNormalizedSubProcessFileNames(task)
  }

  const getTaskAvgDurationValue = (taskId) => {
    const task = activeItems.find((item) => item.id === taskId)
    return getTaskAvgDuration(task)
  }

  const getTaskErrors = (taskId) => {
    const task = activeItems.find((item) => item.id === taskId)
    const errors = task?.errors
    return Array.isArray(errors) ? errors.filter((entry) => entry && typeof entry === 'object') : []
  }

  const getRelatedTasksForApplication = (applicationName) => {
    if (!applicationName) {
      return []
    }

    return activeItems
      .filter((item) => {
        if (item.type !== 'task') {
          return false
        }
        const apps = Array.isArray(item.applications) ? item.applications : []
        return apps.includes(applicationName)
      })
      .map((item) => item.name || item.id)
  }

  const onNoteTextChange = (event) => {
    const nextText = event.target.value
    setNoteDialogState((previous) => ({ ...previous, text: nextText }))
  }

  const onNoteColorChange = (nextColor) => {
    setNoteDialogState((previous) => ({ ...previous, color: nextColor }))
  }

  const onCancelNote = () => {
    setNoteDialogState({ open: false, x: 0, y: 0, noteId: '', diagramX: 0, diagramY: 0, color: NOTE_DEFAULT_COLOR, text: '' })
  }

  const persistDiagramNotes = async (tab, notes) => {
    if (!tab) {
      return
    }

    const payload = serializeDiagramPayload(tab.items, notes)
    const fileName = tab.fileName || `${tab.title || 'diagram'}.json`

    const response = await fetch('/api/save-diagram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName, payload }),
    })

    if (!response.ok) {
      throw new Error('Local save API unavailable')
    }
  }

  const onSaveNote = async () => {
    const tabId = activeTab?.id
    if (!tabId) {
      onCancelNote()
      return
    }

    const trimmedText = noteDialogState.text.trim()
    if (!trimmedText) {
      onCancelNote()
      return
    }

    const existingNotes = activeNotes || []
    const nextNotes = noteDialogState.noteId
      ? existingNotes.map((note) =>
          note.id === noteDialogState.noteId
            ? {
                ...note,
                text: trimmedText,
                x: noteDialogState.diagramX,
                y: noteDialogState.diagramY,
                color: noteDialogState.color,
              }
            : note
        )
      : [
          ...existingNotes,
          {
            id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            x: noteDialogState.diagramX,
            y: noteDialogState.diagramY,
            width: NOTE_WIDTH,
            height: NOTE_HEIGHT,
            color: noteDialogState.color,
            text: trimmedText,
          },
        ]

    setNotesByTabId((previousNotesByTabId) => ({
      ...previousNotesByTabId,
      [tabId]: nextNotes,
    }))

    try {
      await persistDiagramNotes(activeTab, nextNotes)
      setError('')
    } catch {
      setError('Unable to save notes to the project output file.')
    }

    onCancelNote()
  }

  const onDeleteNote = async () => {
    const tabId = activeTab?.id
    if (!tabId || !noteDialogState.noteId) {
      onCancelNote()
      return
    }

    const existingNotes = activeNotes || []
    const nextNotes = existingNotes.filter((note) => note.id !== noteDialogState.noteId)

    setNotesByTabId((previousNotesByTabId) => ({
      ...previousNotesByTabId,
      [tabId]: nextNotes,
    }))

    try {
      await persistDiagramNotes(activeTab, nextNotes)
      setError('')
    } catch {
      setError('Unable to save notes to the project output file.')
    }

    onCancelNote()
  }

  const onDividerMouseDown = (event) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    setIsResizingPanels(true)
  }

  const onCanvasMouseUp = () => {
    if (isResizingNote) {
      const resizingNoteId = noteResizeStateRef.current.noteId
      const startedWidth = noteResizeStateRef.current.startNoteWidth
      const startedHeight = noteResizeStateRef.current.startNoteHeight
      const resizedNotes = activeTab?.id ? notesByTabId[activeTab.id] || activeNotes : activeNotes
      const resizedNote = resizedNotes.find((note) => note.id === resizingNoteId)
      const endedWidth = getNoteWidth(resizedNote)
      const endedHeight = getNoteHeight(resizedNote)
      const wasResized =
        Math.abs(endedWidth - startedWidth) > 0.5 || Math.abs(endedHeight - startedHeight) > 0.5

      if (wasResized && activeTab?.id) {
        void persistDiagramNotes(activeTab, resizedNotes)
          .then(() => {
            setError('')
          })
          .catch(() => {
            setError('Unable to save notes to the project output file.')
          })
      }

      setIsResizingNote(false)
      noteResizeStateRef.current = {
        noteId: '',
        startClientX: 0,
        startClientY: 0,
        startNoteWidth: NOTE_WIDTH,
        startNoteHeight: NOTE_HEIGHT,
      }
      return
    }

    if (isDraggingNote) {
      const wasMoved = noteDragStateRef.current.moved
      const noteId = noteDragStateRef.current.noteId
      setIsDraggingNote(false)

      if (wasMoved && activeTab?.id) {
        const movedNotes = notesByTabId[activeTab.id] || activeNotes
        void persistDiagramNotes(activeTab, movedNotes)
          .then(() => {
            setError('')
          })
          .catch(() => {
            setError('Unable to save notes to the project output file.')
          })
      }

      if (!wasMoved && noteId) {
        const wrap = canvasWrapRef.current
        const note = activeNotes.find((candidate) => candidate.id === noteId)
        if (wrap && note) {
          const dialogPosition = getOverlayPosition(
            wrap,
            noteDragStateRef.current.startClientX,
            noteDragStateRef.current.startClientY,
            280,
            220
          )
          setNoteDialogState({
            open: true,
            x: dialogPosition.x,
            y: dialogPosition.y,
            noteId: note.id,
            diagramX: note.x,
            diagramY: note.y,
            color: getNoteColor(note),
            text: note.text || '',
          })
        }
      }

      noteDragStateRef.current = {
        noteId: '',
        startClientX: 0,
        startClientY: 0,
        startNoteX: 0,
        startNoteY: 0,
        moved: false,
      }
      return
    }

    if (!isPanning) {
      return
    }

    setIsPanning(false)

    if (!panningMovedRef.current && panningTaskCandidateRef.current) {
      const selectedTask = activeItems.find((item) => item.id === panningTaskCandidateRef.current)
      setSelectedTaskId(panningTaskCandidateRef.current)
      if (selectedTask) {
        console.log(selectedTask.name || selectedTask.id)
      }
      panningTaskCandidateRef.current = ''
      panningMovedRef.current = false
      panVelocityRef.current = { x: 0, y: 0 }
      return
    }

    panningTaskCandidateRef.current = ''
    panningMovedRef.current = false

    const wrap = canvasWrapRef.current
    if (!wrap) {
      return
    }

    let velocityX = panVelocityRef.current.x
    let velocityY = panVelocityRef.current.y
    const minimumVelocity = 0.02
    if (Math.abs(velocityX) < minimumVelocity && Math.abs(velocityY) < minimumVelocity) {
      panVelocityRef.current = { x: 0, y: 0 }
      return
    }

    if (panAnimationFrameRef.current) {
      window.cancelAnimationFrame(panAnimationFrameRef.current)
      panAnimationFrameRef.current = 0
    }

    let lastTime = performance.now()
    const frictionPerFrame = 0.92

    const animate = (timestamp) => {
      const elapsed = Math.max(1, timestamp - lastTime)
      lastTime = timestamp

      const scale = elapsed / 16.67
      wrap.scrollLeft -= velocityX * elapsed
      wrap.scrollTop -= velocityY * elapsed

      velocityX *= frictionPerFrame ** scale
      velocityY *= frictionPerFrame ** scale

      if (Math.abs(velocityX) < minimumVelocity && Math.abs(velocityY) < minimumVelocity) {
        panVelocityRef.current = { x: 0, y: 0 }
        panAnimationFrameRef.current = 0
        return
      }

      panAnimationFrameRef.current = window.requestAnimationFrame(animate)
    }

    panAnimationFrameRef.current = window.requestAnimationFrame(animate)
  }

  const onZoomIn = () => {
    setZoomLevel((previous) => Math.min(MAX_ZOOM, Math.round((previous + ZOOM_STEP) * 10) / 10))
  }

  const onZoomOut = () => {
    setZoomLevel((previous) => Math.max(MIN_ZOOM, Math.round((previous - ZOOM_STEP) * 10) / 10))
  }

  const onSelectTab = async (tabId) => {
    if (tabId === activeTabId) {
      return
    }

    const destinationTab = tabs.find((t) => t.id === tabId)
    if (!destinationTab) {
      setActiveTabId(tabId)
      return
    }

    const wrap = canvasWrapRef.current
    if (!wrap) {
      setActiveTabId(tabId)
      return
    }

    const destItems = destinationTab.items || []
    const destNotes = notesByTabId[tabId] || []
    const destBounds = getBounds(destItems, destNotes, notesCollapsed)

    // Start: current active diagram's bounding box on the canvas
    const startLeft = Math.max(8, bounds.minX + bounds.offsetX) * zoomLevel
    const startTop = Math.max(8, bounds.minY + bounds.offsetY) * zoomLevel
    const startWidth = Math.max(60, bounds.width) * zoomLevel
    const startHeight = Math.max(40, bounds.height) * zoomLevel

    const endLeft = Math.max(8, destBounds.minX + destBounds.offsetX) * zoomLevel
    const endTop = Math.max(8, destBounds.minY + destBounds.offsetY) * zoomLevel
    const endWidth = Math.max(120, destBounds.width) * zoomLevel
    const endHeight = Math.max(120, destBounds.height) * zoomLevel

    if (taskExpandTimeoutRef.current) {
      window.clearTimeout(taskExpandTimeoutRef.current)
      taskExpandTimeoutRef.current = 0
    }

    setTaskExpandTransition({ left: startLeft, top: startTop, width: startWidth, height: startHeight, expanded: false, opacity: 0 })

    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        setTaskExpandTransition({ left: endLeft, top: endTop, width: endWidth, height: endHeight, expanded: false, opacity: 0.96 })
        taskExpandTimeoutRef.current = window.setTimeout(resolve, TASK_EXPAND_ANIMATION_MS)
      })
    })

    setActiveTabId(tabId)

    // expanded:true reveals the canvas (now showing new diagram) and starts fade-out
    setTaskExpandTransition((prev) => prev ? { ...prev, expanded: true } : null)
    taskExpandTimeoutRef.current = window.setTimeout(() => {
      setTaskExpandTransition(null)
      taskExpandTimeoutRef.current = 0
    }, TASK_EXPAND_ANIMATION_MS)
  }

  const renderTabNode = (node) => {
    const { tab, children } = node
    const hasChildren = children.length > 0
    const isCollapsed = collapsedTabIds.has(tab.id)

    return (
      <li key={tab.id}>
        <div className={tab.id === activeTabId ? 'tab active' : 'tab'}>
          {hasChildren ? (
            <button
              type="button"
              className="tab-toggle"
              aria-label={isCollapsed ? `Expand ${tab.title}` : `Collapse ${tab.title}`}
              onClick={() => onToggleCollapsed(tab.id)}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="tab-toggle-spacer" aria-hidden="true" />
          )}
          <button type="button" className="tab-label" onClick={() => onSelectTab(tab.id)}>
            {tab.title}
          </button>
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${tab.title}`}
            onClick={() => onCloseTab(tab.id)}
          >
            ×
          </button>
        </div>
        {hasChildren && !isCollapsed ? <ul>{children.map((child) => renderTabNode(child))}</ul> : null}
      </li>
    )
  }

  return (
    <div className={`app theme-${themeName}`}>
      <header className="top-frame">
        <h1>BPMN IQ</h1>
        <div className="file-picker">
          <span>Load Business Process Flow</span>
          <label htmlFor="diagram-file-input" className="file-button">Choose File</label>
          <button type="button" className="file-button" onClick={() => setNotesCollapsed((previous) => !previous)}>
            {notesCollapsed ? 'Expand Notes' : 'Collapse Notes'}
          </button>
          <button type="button" className="file-button" onClick={() => setIsFlowAnimationEnabled((previous) => !previous)}>
            {isFlowAnimationEnabled ? 'Pause Flow' : 'Play Flow'}
          </button>
          <label className="theme-picker">
            <span>Flow Speed</span>
            <select value={flowSpeedMultiplier} onChange={(event) => setFlowSpeedMultiplier(Number(event.target.value) || 1)}>
              {FLOW_SPEED_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="gateway-legend" aria-label="Gateway legend">
            {GATEWAY_LEGEND_ITEMS.map((item) => (
              <span key={item.type} className="gateway-legend-item">
                <GatewayLegendIcon markerType={item.type} />
                <span>{item.label}</span>
              </span>
            ))}
          </div>
          <input
            id="diagram-file-input"
            className="hidden-input"
            type="file"
            accept=".json,application/json"
            onChange={onFileSelected}
          />
          <label className="theme-picker">
            <span>Theme</span>
            <select value={themeName} onChange={(event) => setThemeName(event.target.value)}>
              {THEME_OPTIONS.map((theme) => (
                <option key={theme.value} value={theme.value}>{theme.label}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="layout" ref={layoutRef}>
        <aside className="left-panel" style={{ width: `${leftPanelPercent}%` }}>
          <header className="toolbar">
            <div className="tab-strip">
              <ul className="tab-tree">{tabTree.map((node) => renderTabNode(node))}</ul>
            </div>
            {error ? <p className="error">{error}</p> : null}
          </header>
        </aside>

        <div
          className="panel-divider"
          role="separator"
          aria-label="Resize panels"
          aria-orientation="vertical"
          onMouseDown={onDividerMouseDown}
        />

        <section className="right-panel">
          <div className="zoom-controls" aria-label="Diagram zoom controls">
            <button type="button" onClick={onZoomOut}>−</button>
            <span>{Math.round(zoomLevel * 100)}%</span>
            <button type="button" onClick={onZoomIn}>+</button>
          </div>
          <div className="canvas-wrap" ref={canvasWrapRef} onContextMenu={onCanvasWrapContextMenu}>
            <canvas
              ref={canvasRef}
              className={taskExpandTransition && !taskExpandTransition.expanded ? 'canvas-transitioning' : ''}
              aria-label="BPMN diagram canvas"
              onMouseMove={onCanvasMouseMove}
              onMouseDown={onCanvasMouseDown}
              onMouseUp={onCanvasMouseUp}
              onContextMenu={onCanvasContextMenu}
            />
            {taskExpandTransition ? (
              <div
                className={taskExpandTransition.expanded ? 'task-expand-transition expanded' : 'task-expand-transition'}
                style={{
                  left: `${taskExpandTransition.left}px`,
                  top: `${taskExpandTransition.top}px`,
                  width: `${taskExpandTransition.width}px`,
                  height: `${taskExpandTransition.height}px`,
                  opacity: taskExpandTransition.opacity ?? 0.96,
                }}
              />
            ) : null}
            {taskMenuState.open ? (
              <div
                className="task-menu"
                style={{ left: `${taskMenuState.x}px`, top: `${taskMenuState.y}px` }}
                onClick={(event) => event.stopPropagation()}
              >
                <p>Task Options</p>
                <div className="task-menu-actions">
                  <button type="button" onClick={() => onDialogOptionClick('Description')}>Description</button>
                  <button type="button" onClick={() => onDialogOptionClick('Applications')}>Applications</button>
                  <button type="button" onClick={() => onDialogOptionClick('SubProcesses')}>SubProcesses</button>
                  <button type="button" onClick={() => onDialogOptionClick('Metrics')}>Metrics</button>
                  <button type="button" onClick={() => onDialogOptionClick('Volumes')}>Volumes</button>
                  <button
                    type="button"
                    onClick={() => onDialogOptionClick('Outages')}
                    style={{ color: getTaskErrors(taskMenuState.taskId).length ? '#dc2626' : undefined }}
                  >
                    Outages
                  </button>
                  <button type="button" onClick={() => onDialogOptionClick('Performance Score')}>Performance Score</button>
                </div>
              </div>
            ) : null}
            {metricsDialogState.open ? (
              <div
                className="metrics-dialog"
                style={{ left: `${metricsDialogState.x}px`, top: `${metricsDialogState.y}px` }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="metrics-dialog-head">
                  <p>Metircs</p>
                  <button type="button" onClick={onCloseMetricsDialog}>Close</button>
                </div>
                <p className="metrics-dialog-subtitle">
                  {activeItems.find((item) => item.id === metricsDialogState.taskId)?.name
                    || metricsDialogState.taskId
                    || 'Task'}
                </p>
                <ul className="metrics-list">
                  <li>
                    <strong>Avg Duration:</strong>{' '}
                    {metricsDialogState.avgDuration || getTaskAvgDurationValue(metricsDialogState.taskId)}
                  </li>
                </ul>
              </div>
            ) : null}
            {outagesDialogState.open ? (
              <div
                className="metrics-dialog"
                style={{ left: `${outagesDialogState.x}px`, top: `${outagesDialogState.y}px`, width: `${OUTAGES_DIALOG_WIDTH}px`, maxHeight: `${OUTAGES_DIALOG_HEIGHT}px`, overflowY: 'auto' }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="metrics-dialog-head">
                  <p>Outages</p>
                  <button type="button" onClick={onCloseOutagesDialog}>Close</button>
                </div>
                <p className="metrics-dialog-subtitle">
                  {activeItems.find((item) => item.id === outagesDialogState.taskId)?.name
                    || outagesDialogState.taskId
                    || 'Task'}
                </p>
                {getTaskErrors(outagesDialogState.taskId).length ? (
                  <ul className="metrics-list">
                    {getTaskErrors(outagesDialogState.taskId).map((errorEntry, index) => (
                      <li key={`${outagesDialogState.taskId}-error-${index}`}>
                        <strong>DB:</strong> {errorEntry['db.name'] || 'N/A'}<br />
                        <strong>Statement:</strong> {errorEntry.statement || 'N/A'}<br />
                        <strong>Error:</strong> {errorEntry.error_message || 'N/A'}<br />
                        <strong>Type:</strong> {errorEntry.type || 'N/A'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="metrics-list">
                    <li>No outages/error records for this task.</li>
                  </ul>
                )}
              </div>
            ) : null}
            {subProcessesDialogState.open ? (
              <div
                className="subprocesses-dialog"
                style={{ left: `${subProcessesDialogState.x}px`, top: `${subProcessesDialogState.y}px` }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="subprocesses-dialog-head">
                  <p>SubProcesses</p>
                  <button type="button" onClick={() => onCloseSubProcessesDialog()}>Close</button>
                </div>
                <p className="subprocesses-dialog-subtitle">
                  {activeItems.find((item) => item.id === subProcessesDialogState.taskId)?.name
                    || subProcessesDialogState.taskId
                    || 'Task'}
                </p>
                <div className="subprocesses-dialog-body">
                  <div className="subprocesses-list" role="list">
                    {getTaskSubProcesses(subProcessesDialogState.taskId).length ? (
                      getTaskSubProcesses(subProcessesDialogState.taskId).map((subprocess) => (
                        <button
                          key={subprocess}
                          type="button"
                          className={subProcessesDialogState.selectedSubProcess === subprocess ? 'subprocess-button selected' : 'subprocess-button'}
                          onClick={() => onSelectSubProcess(subprocess)}
                          onDoubleClick={() => onLoadSubProcessDiagram(subprocess)}
                        >
                          {subprocess}
                        </button>
                      ))
                    ) : (
                      <p className="no-items">No subprocesses available</p>
                    )}
                  </div>
                </div>
                <div className="subprocesses-dialog-footer">
                  <button type="button" onClick={() => onLoadSubProcessDiagram(subProcessesDialogState.selectedSubProcess)} disabled={!subProcessesDialogState.selectedSubProcess}>
                    Load Selected
                  </button>
                </div>
              </div>
            ) : null}
            {applicationsDialogState.open ? (
              <div
                className="applications-dialog"
                style={{ left: `${applicationsDialogState.x}px`, top: `${applicationsDialogState.y}px` }}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => onApplicationsDialogMouseDown(event, 'floating', false)}
              >
                <div
                  className="applications-dialog-head"
                  onMouseDown={(event) => onApplicationsDialogMouseDown(event, 'floating', false)}
                >
                  <p>Applications</p>
                  <div className="applications-dialog-head-actions">
                    <button
                      type="button"
                      className="pin-icon-button"
                      aria-label="Pin applications dialog"
                      aria-pressed="false"
                      title="Pin"
                      onClick={() => onTogglePinApplicationsDialog('floating', false)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path
                          d="M8 3h8v2l-2 2v5l2 2v2h-3.7l-1.3 5-1.3-5H6v-2l2-2V7L6 5V3h2z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button type="button" onClick={() => onCloseApplicationsDialog('floating', false)}>Close</button>
                  </div>
                </div>
                <p className="applications-dialog-subtitle">
                  {activeItems.find((item) => item.id === applicationsDialogState.taskId)?.name
                    || applicationsDialogState.taskId
                    || 'Task'}
                </p>
                <div className="applications-dialog-body">
                  <div className="applications-list" role="list">
                    {getTaskApplications(applicationsDialogState.taskId).length ? (
                      getTaskApplications(applicationsDialogState.taskId).map((application) => (
                        <button
                          key={application}
                          type="button"
                          className={
                            applicationsDialogState.selectedApplication === application
                              ? 'application-button selected'
                              : 'application-button'
                          }
                          onClick={() => onSelectApplication(application, 'floating', false)}
                        >
                          {application}
                        </button>
                      ))
                    ) : (
                      <p className="applications-empty">No applications listed for this task.</p>
                    )}
                  </div>
                  <div className="application-detail">
                    <p className="application-detail-title">
                      {applicationsDialogState.selectedApplication || 'Select an application'}
                    </p>
                    {applicationsDialogState.selectedApplication ? (
                      <p className="application-detail-text">
                        Used in {getRelatedTasksForApplication(applicationsDialogState.selectedApplication).length} task
                        {getRelatedTasksForApplication(applicationsDialogState.selectedApplication).length === 1 ? '' : 's'} in this diagram.
                      </p>
                    ) : null}
                    {applicationsDialogState.selectedApplication
                    && getRelatedTasksForApplication(applicationsDialogState.selectedApplication).length ? (
                      <div className="application-related-list">
                        {getRelatedTasksForApplication(applicationsDialogState.selectedApplication).map((taskName) => (
                          <span key={taskName} className="application-related-chip">{taskName}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {pinnedApplicationsDialogs.map((dialog) => (
              <div
                key={dialog.id}
                className="applications-dialog pinned"
                style={{ left: `${dialog.x}px`, top: `${dialog.y}px` }}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => onApplicationsDialogMouseDown(event, dialog.id, true)}
              >
                <div
                  className="applications-dialog-head"
                  onMouseDown={(event) => onApplicationsDialogMouseDown(event, dialog.id, true)}
                >
                  <p>Applications (Pinned)</p>
                  <div className="applications-dialog-head-actions">
                    <button
                      type="button"
                      className="pin-icon-button"
                      aria-label="Unpin applications dialog"
                      aria-pressed="true"
                      title="Unpin"
                      onClick={() => onTogglePinApplicationsDialog(dialog.id, true)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path
                          d="M8 3h8v2l-2 2v5l2 2v2h-3.7l-1.3 5-1.3-5H6v-2l2-2V7L6 5V3h2z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button type="button" onClick={() => onCloseApplicationsDialog(dialog.id, true)}>Close</button>
                  </div>
                </div>
                <p className="applications-dialog-subtitle">
                  {activeItems.find((item) => item.id === dialog.taskId)?.name || dialog.taskId || 'Task'}
                </p>
                <div className="applications-dialog-body">
                  <div className="applications-list" role="list">
                    {getTaskApplications(dialog.taskId).length ? (
                      getTaskApplications(dialog.taskId).map((application) => (
                        <button
                          key={`${dialog.id}-${application}`}
                          type="button"
                          className={dialog.selectedApplication === application ? 'application-button selected' : 'application-button'}
                          onClick={() => onSelectApplication(application, dialog.id, true)}
                        >
                          {application}
                        </button>
                      ))
                    ) : (
                      <p className="applications-empty">No applications listed for this task.</p>
                    )}
                  </div>
                  <div className="application-detail">
                    <p className="application-detail-title">{dialog.selectedApplication || 'Select an application'}</p>
                    {dialog.selectedApplication ? (
                      <p className="application-detail-text">
                        Used in {getRelatedTasksForApplication(dialog.selectedApplication).length} task
                        {getRelatedTasksForApplication(dialog.selectedApplication).length === 1 ? '' : 's'} in this diagram.
                      </p>
                    ) : null}
                    {dialog.selectedApplication && getRelatedTasksForApplication(dialog.selectedApplication).length ? (
                      <div className="application-related-list">
                        {getRelatedTasksForApplication(dialog.selectedApplication).map((taskName) => (
                          <span key={`${dialog.id}-${taskName}`} className="application-related-chip">{taskName}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {noteDialogState.open ? (
              <div
                className="note-dialog"
                style={{ left: `${noteDialogState.x}px`, top: `${noteDialogState.y}px` }}
                onClick={(event) => event.stopPropagation()}
              >
                <p>{noteDialogState.noteId ? 'Edit Note' : 'Add Note'}</p>
                <textarea value={noteDialogState.text} onChange={onNoteTextChange} />
                <label className="note-color-field">
                  <span>Color</span>
                  <div className="note-color-swatches">
                    {NOTE_SWATCH_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={noteDialogState.color === color ? 'note-swatch selected' : 'note-swatch'}
                        style={{ backgroundColor: color }}
                        aria-label={`Select note color ${color}`}
                        onClick={() => onNoteColorChange(color)}
                      />
                    ))}
                  </div>
                </label>
                <div className="note-dialog-actions">
                  {noteDialogState.noteId ? <button type="button" onClick={onDeleteNote}>Delete</button> : null}
                  <button type="button" onClick={onCancelNote}>Cancel</button>
                  <button type="button" onClick={onSaveNote}>Save</button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

export default App
