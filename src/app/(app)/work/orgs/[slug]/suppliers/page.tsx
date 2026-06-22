import { redirect } from "next/navigation";

// Suppliers tab removed — it served no purpose. Redirect to the client overview.
export default function Page({ params }: { params: { slug: string } }) {
  redirect(`/work/orgs/${params.slug}`);
}
