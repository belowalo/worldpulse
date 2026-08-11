import { WorldPulseApp } from "@/components/world-pulse-app";

export default function Home() {
  return (
    <WorldPulseApp initialWorldUrl="/api/live-news?scope=prepared-world" />
  );
}
