import { setupEventListeners } from "./app/events.js?v=20260430-frontend-8";
import { loadSession } from "./app/session.js?v=20260430-frontend-8";

setupEventListeners();
void loadSession();
