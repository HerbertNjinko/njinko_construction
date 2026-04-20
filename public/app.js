import { setupEventListeners } from "./app/events.js?v=20260417-frontend-2";
import { loadSession } from "./app/session.js?v=20260417-frontend-2";

setupEventListeners();
void loadSession();
