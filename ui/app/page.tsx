import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Marquee from "./components/Marquee";
import HowItWorks from "./components/HowItWorks";
import Architecture from "./components/Architecture";
import ExecPanel from "./components/ExecPanel";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import MigrationConsole from "./MigrationConsole";
import Reveal from "./components/Reveal";

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <Marquee />
      <HowItWorks />
      <MigrationConsole />
      <Architecture />
      <Reveal className="block">
        <ExecPanel />
      </Reveal>
      <CTA />
      <Footer />
    </>
  );
}
