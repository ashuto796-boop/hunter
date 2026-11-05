import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="font-display text-6xl font-semibold gold-text">404</h1>
      <p className="text-muted-foreground">Cette page n'existe pas.</p>
      <Button asChild><Link to="/">Retour à l'accueil</Link></Button>
    </div>
  );
}
