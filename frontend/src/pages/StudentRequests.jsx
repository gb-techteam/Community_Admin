import { ClipboardList } from "lucide-react";
import SuperkandleRequestsTab from "../components/SuperkandleRequestsTab";

export default function StudentRequests() {
  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <ClipboardList size={14} strokeWidth={2} aria-hidden="true" />
            Management
          </p>
          <h1>Student requests</h1>
          <p>
            People who tried to subscribe but are not in the Greenbonds student
            list yet. Approve to add them as students, or reject.
          </p>
        </div>
      </header>
      <SuperkandleRequestsTab />
    </div>
  );
}
