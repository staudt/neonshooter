/** Fetch a map's source by name (maps/<name>.map). Cache-busted so hot reloads see the new file. */
export async function fetchMapSource(name: string): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}maps/${name}.map?t=${Date.now()}`);
  if (!res.ok) throw new Error(`map "${name}" not found (${res.status})`);
  return res.text();
}

/** Dev only: called with the map name whenever a .map file is saved. */
export function onMapChanged(cb: (name: string) => void) {
  import.meta.hot?.on('neon:map-changed', (data: { name: string }) => cb(data.name));
}
