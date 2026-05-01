import { setupEventListeners } from "./app/events.js?v=20260501-frontend-06";
import { loadSession } from "./app/session.js?v=20260501-frontend-06";

setupEventListeners();
void loadSession();
