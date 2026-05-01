import { setupEventListeners } from "./app/events.js?v=20260501-frontend-04";
import { loadSession } from "./app/session.js?v=20260501-frontend-04";

setupEventListeners();
void loadSession();
