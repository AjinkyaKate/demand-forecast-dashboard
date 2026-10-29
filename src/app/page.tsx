import { redirect } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getStores } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/** With sales on file, the item forecast; with nothing on file, the upload. */
export default async function Home() {
  await ensureDb();
  redirect(getStores().length ? "/items" : "/data");
}
