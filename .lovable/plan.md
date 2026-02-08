

## Add Brand Icons to Products Dropdown

Replace the generic Lucide icons with the actual app icons for InventoryProof and NeckPilot in the Products dropdown menu.

---

### Changes to `src/components/ProductsDropdown.tsx`

- Import the brand icon assets: `inventoryproof-icon.png` and `neckpilot-icon.png`
- Update the `products` array to support both Lucide icons and image-based icons by adding an optional `image` field
- For InventoryProof and NeckPilot, use their brand icons instead of the generic Lucide icons
- Cookie Yeti and HOKU will continue using Lucide icons (no brand icons uploaded for them)
- Update the rendering logic: if a product has an `image`, render an `<img>` tag; otherwise render the Lucide icon as before
- The brand icons will be displayed at the same size as the current icon container (`h-8 w-8`) with `rounded-md` to match the existing style

### Technical Details

The product type will change to support an optional `image` string field alongside the existing `icon`. The render logic in the map will check for `image` first, falling back to the Lucide `icon` component.

No other files need to change.

