import { Suspense } from "react";
import SetPasswordForm from "./form";

export const dynamic = "force-dynamic";

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SetPasswordForm />
    </Suspense>
  );
}
