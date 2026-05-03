import { setupEventListeners } from "./app/events.js?v=20260502-frontend-1";
import { loadSession } from "./app/session.js?v=20260502-frontend-1";

setupEventListeners();
void loadSession();
