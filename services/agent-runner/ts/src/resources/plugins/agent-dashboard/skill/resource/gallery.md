# Image gallery

Use `ImageGallery` to browse a small collection of known images in one conversation-width container. It uses a Coverflow arrangement: the selected image is prominent and neighboring images sit to either side. The host applies theme colors, clipping and responsive sizing; supply content, not CSS or layout controls.

```text
Known images -> ImageGallery -> local previous / next selection
                                   |
                              selected preview -> original-image lightbox
```

## Contract

`ImageGallery(images=[{url:..., description:..., title:...}, ...], title=...)`

- Supply **1 to 12** images in the intended order. Each item requires `url` and an accessible `description`; `title` is an optional caption. The outer `title` is an optional gallery heading.
- Each `url`, `description` and `title` can be a literal string or an initialized absolute string binding such as `$/image`. Keep `images` itself an explicit array; do not bind the array or use a dynamic list template.
- Use only image URLs supplied by the user or verified in tool results: HTTP(S) URLs or `sandbox:/absolute/path`. The same source rules as [media.md](media.md) apply. Do not invent image paths or URLs, and do not embed image bytes.
- Previews may crop to keep the gallery consistent. Opening the selected image shows its original aspect ratio in a lightbox.
- Navigation stays local. It does not send a message, call the model, invoke MCP or trigger a Button action. There are no `action`, `autoplay`, `loop`, `fit`, animation or sizing parameters.
- Browse by dragging horizontally, swiping horizontally with two fingers on a trackpad, using the arrows, or pressing the keyboard arrow keys. Vertical scrolling and pinch-to-zoom retain their browser behavior.
- The gallery starts with the first image, never autoplays and stops at either end. A single-image gallery has no previous/next controls.
- Switching Tabs preserves the selected image while the gallery remains mounted. Reloading history or remounting the visual resets selection to the first image. The host respects reduced-motion preferences.
- Source strings are saved with the reply; image files are not copied into the message. Referenced files or remote URLs must remain accessible for historical viewing.

## Example

This example assumes a tool has confirmed that both report images exist at the paths below. Replace them with known images from the current task. If no verified images are available, omit the gallery rather than inventing sources.

![Quarterly report images](a2ui:report-images)

```a2ui id=report-images
$/detail = "sandbox:/workspace/reports/regional-sales.png"
$/detailDescription = "Regional sales chart comparing revenue with targets"
root = ImageGallery(title="Quarterly report images", images=[{url:"sandbox:/workspace/reports/quarterly-sales.png",description:"Quarterly sales trend chart",title:"Quarterly overview"},{url:$/detail,description:$/detailDescription,title:"Regional detail"}])
```
