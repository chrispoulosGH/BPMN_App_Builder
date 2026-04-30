from __future__ import annotations

import json
from pathlib import Path
import xml.etree.ElementTree as ET
from collections import defaultdict


NAMESPACES = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
}


def to_number(value: str | None) -> int | float | None:
    if value is None:
        return None

    number = float(value)
    return int(number) if number.is_integer() else number


def shape_map_from_root(root: ET.Element) -> dict[str, dict[str, int | float | str | None]]:
    shape_map: dict[str, dict[str, int | float | str | None]] = {}

    for shape in root.findall(".//bpmndi:BPMNShape", NAMESPACES):
        bpmn_element_id = shape.get("bpmnElement")
        if not bpmn_element_id:
            continue

        bounds = shape.find("dc:Bounds", NAMESPACES)
        if bounds is None:
            continue

        shape_map[bpmn_element_id] = {
            "x": to_number(bounds.get("x")),
            "y": to_number(bounds.get("y")),
            "width": to_number(bounds.get("width")),
            "height": to_number(bounds.get("height")),
            "stroke": shape.get("stroke"),
        }

    return shape_map


def edge_data_map_from_root(
    root: ET.Element,
) -> dict[str, dict[str, object]]:
    edge_map: dict[str, dict[str, object]] = {}

    for edge in root.findall(".//bpmndi:BPMNEdge", NAMESPACES):
        bpmn_element_id = edge.get("bpmnElement")
        if not bpmn_element_id:
            continue

        waypoints: list[dict[str, int | float | None]] = []
        for waypoint in edge.findall("di:waypoint", NAMESPACES):
            waypoints.append(
                {
                    "x": to_number(waypoint.get("x")),
                    "y": to_number(waypoint.get("y")),
                }
            )

        edge_map[bpmn_element_id] = {
            "waypoints": waypoints,
            "stroke": edge.get("stroke"),
        }

    return edge_map


def local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def gateway_type_from_tag(tag: str) -> str:
    name = local_name(tag)
    if not name.endswith("Gateway"):
        return "gateway"

    gateway_type = name[: -len("Gateway")]
    return gateway_type[:1].lower() + gateway_type[1:]


def collapse_task_file_map_from_process(process: ET.Element) -> dict[str, str]:
    mapping: dict[str, str] = {}

    for element in process.iter():
        element_name = local_name(element.tag)
        if element_name not in {"collapseTaskFile", "collapsedTaskFile"}:
            continue

        task_ref = (element.get("taskRef") or "").strip()
        file_name = (element.get("fileName") or "").strip()

        if file_name.lower().endswith(".xml"):
            file_name = f"{file_name[:-4]}.json"

        if task_ref and file_name:
            mapping[task_ref] = file_name

    return mapping


def parse_applications_from_text(text: str) -> list[str]:
    values = [part.strip() for part in text.split(",")]
    applications: list[str] = []
    for value in values:
        if value and value not in applications:
            applications.append(value)
    return applications


def task_applications_from_annotations(process: ET.Element) -> dict[str, list[str]]:
    text_by_annotation_id: dict[str, str] = {}

    for annotation in process.findall(".//bpmn:textAnnotation", NAMESPACES):
        annotation_id = (annotation.get("id") or "").strip()
        if not annotation_id:
            continue

        text_node = annotation.find("bpmn:text", NAMESPACES)
        text_value = (text_node.text if text_node is not None else "") or ""
        text_by_annotation_id[annotation_id] = text_value.strip()

    applications_by_task_id: dict[str, list[str]] = defaultdict(list)

    for association in process.findall(".//bpmn:association", NAMESPACES):
        source_ref = (association.get("sourceRef") or "").strip()
        target_ref = (association.get("targetRef") or "").strip()
        if not source_ref or not target_ref:
            continue

        annotation_text = text_by_annotation_id.get(source_ref, "")
        if not annotation_text:
            continue

        for application in parse_applications_from_text(annotation_text):
            if application not in applications_by_task_id[target_ref]:
                applications_by_task_id[target_ref].append(application)

    return applications_by_task_id


def parse_bpmn_file(xml_path: Path) -> list[dict[str, object]]:
    root = ET.parse(xml_path).getroot()
    process = root.find("bpmn:process", NAMESPACES)
    if process is None:
        return []

    shapes = shape_map_from_root(root)
    edge_data = edge_data_map_from_root(root)
    collapse_task_file_map = collapse_task_file_map_from_process(process)
    applications_by_task_id = task_applications_from_annotations(process)
    rows: list[dict[str, object]] = []
    incoming_gateway_refs: dict[str, list[str]] = defaultdict(list)
    outgoing_gateway_refs: dict[str, list[str]] = defaultdict(list)

    sequence_flows = process.findall(".//bpmn:sequenceFlow", NAMESPACES)
    for flow in sequence_flows:
        source_ref = flow.get("sourceRef", "")
        target_ref = flow.get("targetRef", "")

        if target_ref:
            incoming_gateway_refs[target_ref].append(source_ref)
        if source_ref:
            outgoing_gateway_refs[source_ref].append(target_ref)

    for lane in process.findall(".//bpmn:lane", NAMESPACES):
        lane_id = lane.get("id", "")
        lane_shape = shapes.get(lane_id, {})
        rows.append(
            {
                "id": lane_id,
                "type": "lane",
                "name": lane.get("name", ""),
                "x": lane_shape.get("x"),
                "y": lane_shape.get("y"),
                "height": lane_shape.get("height"),
                "width": lane_shape.get("width"),
                "shape": "rectangle",
                "color": lane_shape.get("stroke"),
            }
        )

    for task in process.findall(".//bpmn:task", NAMESPACES):
        task_id = task.get("id", "")
        task_shape = shapes.get(task_id, {})
        task_row: dict[str, object] = {
            "id": task_id,
            "type": "task",
            "name": task.get("name", ""),
            "applications": applications_by_task_id.get(task_id, []),
            "x": task_shape.get("x"),
            "y": task_shape.get("y"),
            "height": task_shape.get("height"),
            "width": task_shape.get("width"),
            "shape": "rectangle",
            "color": task_shape.get("stroke"),
        }

        sub_process_file_name = collapse_task_file_map.get(task_id)
        if sub_process_file_name:
            task_row["subProcessFileName"] = sub_process_file_name

        rows.append(task_row)

    for sub_process in process.findall(".//bpmn:subProcess", NAMESPACES):
        sub_process_id = sub_process.get("id", "")
        sub_process_shape = shapes.get(sub_process_id, {})
        sub_process_row: dict[str, object] = {
            "id": sub_process_id,
            "type": "task",
            "name": sub_process.get("name", ""),
            "applications": applications_by_task_id.get(sub_process_id, []),
            "x": sub_process_shape.get("x"),
            "y": sub_process_shape.get("y"),
            "height": sub_process_shape.get("height"),
            "width": sub_process_shape.get("width"),
            "shape": "rectangle",
            "color": sub_process_shape.get("stroke"),
        }

        sub_process_file_name = collapse_task_file_map.get(sub_process_id)
        if sub_process_file_name:
            sub_process_row["subProcessFileName"] = sub_process_file_name

        rows.append(sub_process_row)

    for start_event in process.findall(".//bpmn:startEvent", NAMESPACES):
        event_id = start_event.get("id", "")
        event_shape = shapes.get(event_id, {})
        rows.append(
            {
                "id": event_id,
                "type": "event",
                "name": start_event.get("name", ""),
                "x": event_shape.get("x"),
                "y": event_shape.get("y"),
                "height": event_shape.get("height"),
                "width": event_shape.get("width"),
                "shape": "circle",
                "color": event_shape.get("stroke"),
            }
        )

    for end_event in process.findall(".//bpmn:endEvent", NAMESPACES):
        event_id = end_event.get("id", "")
        event_shape = shapes.get(event_id, {})
        rows.append(
            {
                "id": event_id,
                "type": "event",
                "name": end_event.get("name", ""),
                "x": event_shape.get("x"),
                "y": event_shape.get("y"),
                "height": event_shape.get("height"),
                "width": event_shape.get("width"),
                "shape": "circle",
                "color": event_shape.get("stroke"),
            }
        )

    for element in process.iter():
        tag_name = local_name(element.tag)
        if not tag_name.endswith("Gateway"):
            continue

        gateway_id = element.get("id", "")
        gateway_shape = shapes.get(gateway_id, {})
        rows.append(
            {
                "id": gateway_id,
                "name": element.get("name", ""),
                "soureRef": incoming_gateway_refs.get(gateway_id, []),
                "targetRef": outgoing_gateway_refs.get(gateway_id, []),
                "type": gateway_type_from_tag(element.tag),
                "shape": "diamond",
                "x": gateway_shape.get("x"),
                "y": gateway_shape.get("y"),
                "width": gateway_shape.get("width"),
                "height": gateway_shape.get("height"),
                "color": gateway_shape.get("stroke"),
            }
        )

    for flow in sequence_flows:
        flow_id = flow.get("id", "")
        flow_di = edge_data.get(flow_id, {})
        rows.append(
            {
                "id": flow_id,
                "sourceRef": flow.get("sourceRef", ""),
                "targetRef": flow.get("targetRef", ""),
                "type": "flow",
                "shape": "line",
                "waypoints": flow_di.get("waypoints", []),
                "color": flow_di.get("stroke"),
            }
        )

    return rows


def run() -> None:
    script_dir = Path(__file__).resolve().parent
    workspace_root = script_dir.parent.parent
    xml_dir = workspace_root / "xml"
    output_dir = script_dir.parent / "output" / "xml2json"

    output_dir.mkdir(parents=True, exist_ok=True)

    xml_files = sorted(xml_dir.glob("*_di.xml"))
    if not xml_files:
        print(f"No *_di.xml files found under: {xml_dir}")
        return

    for xml_file in xml_files:
        rows = parse_bpmn_file(xml_file)
        output_file = output_dir / f"{xml_file.stem}.json"
        output_file.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"{xml_file.name} -> {output_file.name} ({len(rows)} records)")


if __name__ == "__main__":
    run()