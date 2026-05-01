import { setupEventListeners } from "./app/events.js?v=20260501-frontend-09";
import { loadSession } from "./app/session.js?v=20260501-frontend-09";

setupEventListeners();
void loadSession();
