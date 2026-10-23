import { Suspense, lazy, useEffect, useState } from "react";
import { GAME_ADDRESS } from "@/config";
import { FomoDashboard, type RoundView } from "@/components/FomoDashboard";

const LiveApp = lazy(() => import("./LiveApp"));
const preview: RoundView = {
  pot: 3_300_000n,
  price: 1_300_000n,
  deadline: Math.floor(Date.now() / 1000) + 8 * 60 + 42,
  keys: 3n,
  settled: false,
  leader: "0x7a7b8cb48210...",
};

function PreviewApp() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <FomoDashboard state={preview} now={now} mode="preview" accountId={GAME_ADDRESS} />;
}

export default function App() {
  if (!GAME_ADDRESS) return <PreviewApp />;
  return <Suspense fallback={<PreviewApp />}><LiveApp /></Suspense>;
}
