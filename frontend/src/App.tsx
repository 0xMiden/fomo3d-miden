import { Suspense, lazy, useEffect, useState } from "react";
import { GAME_ADDRESS } from "@/config";
import { FomoDashboard } from "@/components/FomoDashboard";
import { previewState } from "@/lib/fomo/preview";

const LiveApp = lazy(() => import("./LiveApp"));

function PreviewApp() {
  const [preview] = useState(previewState);
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
