import { setupEventListeners } from "./app/events.js?v=20260430-frontend-16";
import { loadSession } from "./app/session.js?v=20260430-frontend-16";

setupEventListeners();
void loadSession();
