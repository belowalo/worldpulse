import { WorldPulseApp } from "@/components/world-pulse-app";

export default function Home() {
  return <WorldPulseApp liveWorldUrl="/api/live-news?scope=world-live" />;
}
