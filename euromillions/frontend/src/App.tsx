import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Loading } from "@/components/common";
import { Layout } from "@/components/Layout";
import Home from "@/pages/Home";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const History = lazy(() => import("@/pages/History"));
const FrequencyStats = lazy(() => import("@/pages/FrequencyStats"));
const Combinations = lazy(() => import("@/pages/Combinations"));
const Generator = lazy(() => import("@/pages/Generator"));
const Optimizer = lazy(() => import("@/pages/Optimizer"));
const Simulator = lazy(() => import("@/pages/Simulator"));
const AILab = lazy(() => import("@/pages/AILab"));
const Jackpot = lazy(() => import("@/pages/Jackpot"));
const Budget = lazy(() => import("@/pages/Budget"));
const SavedGrids = lazy(() => import("@/pages/SavedGrids"));
const Verification = lazy(() => import("@/pages/Verification"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const StrategyLab = lazy(() => import("@/pages/StrategyLab"));
const Comparator = lazy(() => import("@/pages/Comparator"));
const Research = lazy(() => import("@/pages/Research"));
const Audit = lazy(() => import("@/pages/Audit"));
const NotFound = lazy(() => import("@/pages/NotFound"));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tableau-de-bord" element={<Dashboard />} />
          <Route path="/historique" element={<History />} />
          <Route path="/statistiques/numeros" element={<FrequencyStats kind="numbers" />} />
          <Route path="/statistiques/etoiles" element={<FrequencyStats kind="stars" />} />
          <Route path="/analyse" element={<Combinations />} />
          <Route path="/generateur" element={<Generator />} />
          <Route path="/optimiseur" element={<Optimizer />} />
          <Route path="/simulateur" element={<Simulator />} />
          <Route path="/laboratoire-ia" element={<AILab />} />
          <Route path="/jackpot" element={<Jackpot />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/mes-grilles" element={<SavedGrids />} />
          <Route path="/verification" element={<Verification />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="/strategies" element={<StrategyLab />} />
          <Route path="/comparateur" element={<Comparator />} />
          <Route path="/recherche" element={<Research />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
