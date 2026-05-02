import { setupEventListeners } from "./app/events.js?v=20260501-frontend-12";
import { loadSession } from "./app/session.js?v=20260501-frontend-12";

setupEventListeners();
void loadSession();
