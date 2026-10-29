import { redirect } from "next/navigation";
import { getStores } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/** With sales on file, the item forecast; with nothing on file, the upload. */
export default function Home() {
  redirect(getStores().length ? "/items" : "/data");
}
