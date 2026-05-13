import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";

const SOUND_FILE = "/System/Library/Sounds/Submarine.aiff";

function playDoneSound() {
  // Fire-and-forget so the extension never blocks pi from becoming idle.
  const child = spawn("afplay", [SOUND_FILE], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

export default function (pi: ExtensionAPI) {
  // agent_end fires after pi has finished handling a user prompt.
  pi.on("agent_end", async () => {
    playDoneSound();
  });
}
