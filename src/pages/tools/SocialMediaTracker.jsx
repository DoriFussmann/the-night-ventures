import { Navigate, useParams } from "react-router-dom";

/** Legacy route — Social & Shops now lives on Company Data. */
export default function SocialMediaTracker() {
  const { companyId } = useParams();
  if (!companyId) return <Navigate to="/" replace />;
  return (
    <Navigate
      to={`/company/${companyId}/company-data?panel=social-shops`}
      replace
    />
  );
}
