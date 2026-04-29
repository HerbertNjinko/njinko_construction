import { setupEventListeners } from "./app/events.js?v=20260429-frontend-6";
import { loadSession } from "./app/session.js?v=20260429-frontend-6";

setupEventListeners();
void loadSession();
