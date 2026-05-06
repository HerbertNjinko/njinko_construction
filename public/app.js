import { setupEventListeners } from "./app/events.js?v=20260504-frontend-21";
import { loadSession } from "./app/session.js?v=20260504-frontend-21";

setupEventListeners();
void loadSession();
