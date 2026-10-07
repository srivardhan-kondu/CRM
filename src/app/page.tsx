import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/authz/context";

export default async function Home() {
  redirect((await getIdentity()) ? "/dashboard" : "/login");
}
