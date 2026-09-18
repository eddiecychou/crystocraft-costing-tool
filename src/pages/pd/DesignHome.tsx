import { Link } from "react-router-dom";

export default function DesignHome() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl mb-2">Product Design</h1>
      <p className="text-ink-70 mb-8">
        Supplier products → prompt templates → generations. A brand-aware
        image-prompt workbench: analyse a product photo, apply a customer&rsquo;s
        brand identity, and manage spec sheets. Customers and suppliers are the
        live Operation Center records — manage those in their own sections.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link to="/design/products" className="btn btn-primary">Products</Link>
        <Link to="/design/templates" className="btn btn-secondary">Templates</Link>
        <Link to="/design/generations" className="btn btn-secondary">Generations</Link>
      </div>
    </main>
  );
}
