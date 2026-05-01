import { setupEventListeners } from "./app/events.js?v=20260501-frontend-10";
import { loadSession } from "./app/session.js?v=20260501-frontend-10";

setupEventListeners();
void loadSession();
