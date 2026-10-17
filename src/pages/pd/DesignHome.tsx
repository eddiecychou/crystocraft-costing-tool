import ProductDesignNav from "../../components/ProductDesignNav";

export default function DesignHome() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <ProductDesignNav />
      <h1 className="text-2xl mb-2">Product Design</h1>
      <p className="text-ink-70 mb-8">
        Supplier products → prompt templates → generations. A brand-aware
        image-prompt workbench: analyse a product photo, apply a customer&rsquo;s
        brand identity, and manage spec sheets. Customers and suppliers are the
        live Operation Center records — manage those in their own sections.
      </p>

    </main>
  );
}
