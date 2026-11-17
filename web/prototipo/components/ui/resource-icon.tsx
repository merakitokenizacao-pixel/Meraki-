import {
  Boxes,
  Cpu,
  Database,
  DatabaseZap,
  Globe,
  HardDrive,
  Layers,
  Network,
  Radio,
  Search,
  Server,
  Workflow,
  Zap,
  type LucideIcon,
  BrainCircuit,
  Rows3,
  Waypoints,
} from "lucide-react";
import type { Category, ResourceType } from "@/lib/data/infra";

export const RESOURCE_ICONS: Record<ResourceType, LucideIcon> = {
  postgres: Database,
  mysql: Database,
  mongodb: Layers,
  vector: Waypoints,
  olap: Rows3,
  redis: Zap,
  kafka: Radio,
  rabbitmq: Network,
  service: Server,
  gateway: BrainCircuit,
  cdn: Globe,
  k8s: Boxes,
  gpu: Cpu,
  storage: HardDrive,
  search: Search,
  orchestrator: Workflow,
};

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  db: Database,
  cache: DatabaseZap,
  messaging: Radio,
  service: Server,
  compute: Cpu,
  storage: HardDrive,
  pipeline: Workflow,
};

export function ResourceIcon({ type, className, strokeWidth = 1.75 }: { type: ResourceType; className?: string; strokeWidth?: number }) {
  const Icon = RESOURCE_ICONS[type];
  return <Icon className={className} strokeWidth={strokeWidth} />;
}
