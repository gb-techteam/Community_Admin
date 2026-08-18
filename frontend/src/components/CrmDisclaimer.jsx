export default function CrmDisclaimer({ entity = "records" }) {
  return (
    <div className="crm-disclaimer" role="note">
      <strong>Disclaimer</strong>
      <p>
        This portal is for viewing and updating {entity} only. To add or delete
        any details, please use the CRM portal.
      </p>
    </div>
  );
}
