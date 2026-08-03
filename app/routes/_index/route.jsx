import { redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // Embedded installs / Admin opens always include shop — send them into the app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Never render a login form inside Admin. If we land here with embedded/host
  // params, bounce to /app so authenticate.admin can recover.
  if (url.searchParams.get("embedded") || url.searchParams.get("host")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Citely</h1>
        <p className={styles.text}>
          Open Citely from your Shopify admin to continue.
        </p>
      </div>
    </div>
  );
}
