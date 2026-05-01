import { setupEventListeners } from "./app/events.js?v=20260501-frontend-07";
import { loadSession } from "./app/session.js?v=20260501-frontend-07";

setupEventListeners();
void loadSession();
