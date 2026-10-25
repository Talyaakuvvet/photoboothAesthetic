// Copies MediaPipe's wasm files into public/ so the site serves them itself
// (runs automatically after `npm install`).
import { cpSync, existsSync, mkdirSync } from "node:fs";

const from = "node_modules/@mediapipe/tasks-vision/wasm";
const to = "public/mediapipe";
if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log("mediapipe wasm → public/mediapipe");
}
