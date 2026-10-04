// Renders every bot mascot awake, one tile each, for capture.mjs to photograph frame by frame.
import { createRoot } from "react-dom/client";
import { BotMascot, MASCOTS } from "@/components/admin/BotMascot";

createRoot(document.getElementById("r")!).render(
  <>
    {Object.keys(MASCOTS).map((k) => (
      <div key={k} className="tile" data-icon={k}>
        <BotMascot icon={k} seed="" watchCursor={false} />
      </div>
    ))}
  </>,
);
