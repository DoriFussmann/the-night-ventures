import mapHtml from "./systemMap.html?raw";

export default function SystemMap() {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      <iframe
        title="TNV System Map"
        srcDoc={mapHtml}
        className="w-full flex-1 rounded-lg border border-border bg-background"
        style={{ minHeight: "calc(100vh - 6rem)" }}
      />
    </div>
  );
}
