import { redirect } from "next/navigation";

// Pipeline replaced by the per-material Sourcing status on the Materials tab.
export default function Page({ params }: { params: { slug: string } }) {
  redirect(`/work/orgs/${params.slug}/materials`);
}
