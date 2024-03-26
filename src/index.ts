// @ts-ignore
import { __serializeForClipboard, EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice, Node } from "@tiptap/pm/model";

export interface DragHandleOptions {
  /**
   * The width of the drag handle
   */
  dragHandleWidth: number;
}
function absoluteRect(node: Element) {
  const data = node.getBoundingClientRect();

  return {
    top: data.top,
    left: data.left,
    width: data.width,
  };
}

function nodeDOMAtCoords(coords: { x: number; y: number }) {
  return document
    .elementsFromPoint(coords.x, coords.y)
    .find(
      (elem: Element) =>
        elem.parentElement?.matches?.(".ProseMirror") ||
        elem.matches(
          [
            "li",
            "p:not(:first-child)",
            "pre",
            "blockquote",
            "h1, h2, h3, h4, h5, h6",
          ].join(", ")
        )
    );
}

function nodePosAtDOM(
  node: Element,
  view: EditorView,
  options: DragHandleOptions
) {
  const boundingRect = node.getBoundingClientRect();

  return view.posAtCoords({
    left: boundingRect.left + 50 + options.dragHandleWidth,
    top: boundingRect.top + 1,
  })?.inside;
}

function calcNodePos(pos: number, view: EditorView) {
  const $pos = view.state.doc.resolve(pos);
  if ($pos.depth > 1) return $pos.before($pos.depth);
  return pos;
}

function DragHandleFunc(options: DragHandleOptions) {
  let listType = "";
  function handleDragStart(event: DragEvent, view: EditorView) {
    view.focus();

    if (!event.dataTransfer) return;

    const node = nodeDOMAtCoords({
      x: event.clientX + 50 + options.dragHandleWidth,
      y: event.clientY,
    });

    if (!(node instanceof Element)) return;

    let draggedNodePos = nodePosAtDOM(node, view, options);
    if (draggedNodePos == null || draggedNodePos < 0) return;
    draggedNodePos = calcNodePos(draggedNodePos, view);

    const { from, to } = view.state.selection;
    const diff = from - to;

    const fromSelectionPos = calcNodePos(from, view);
    let differentNodeSelected = false;

    const nodePos = view.state.doc.resolve(fromSelectionPos);

    // Check if nodePos points to the top level node
    if (nodePos.node().type.name === "doc") differentNodeSelected = true;
    else {
      const nodeSelection = NodeSelection.create(
        view.state.doc,
        nodePos.before()
      );
      // Check if the node where the drag event started is part of the current selection
      differentNodeSelected = !(
        draggedNodePos + 1 >= nodeSelection.$from.pos &&
        draggedNodePos <= nodeSelection.$to.pos
      );
    }

    if (
      !differentNodeSelected &&
      diff !== 0 &&
      !(view.state.selection instanceof NodeSelection)
    ) {
      const endSelection = NodeSelection.create(view.state.doc, to - 1);
      const multiNodeSelection = TextSelection.create(
        view.state.doc,
        draggedNodePos,
        endSelection.$to.pos
      );
      view.dispatch(view.state.tr.setSelection(multiNodeSelection));
    } else {
      const nodeSelection = NodeSelection.create(
        view.state.doc,
        draggedNodePos
      );
      view.dispatch(view.state.tr.setSelection(nodeSelection));
    }

    // If the selected node is a list item, we need to save the type of the wrapping list e.g. OL or UL
    if (
      view.state.selection instanceof NodeSelection &&
      view.state.selection.node.type.name === "listItem"
    ) {
      listType = node.parentElement!.tagName;
    }

    const slice = view.state.selection.content();
    const { dom, text } = __serializeForClipboard(view, slice);

    event.dataTransfer.clearData();
    event.dataTransfer.setData("text/html", dom.innerHTML);
    event.dataTransfer.setData("text/plain", text);
    event.dataTransfer.effectAllowed = "copyMove";

    event.dataTransfer.setDragImage(node, 0, 0);

    view.dragging = { slice, move: event.ctrlKey };
  }

  let dragHandleElement: HTMLElement | null = null;

  function hideDragHandle() {
    if (dragHandleElement) {
      dragHandleElement.classList.add("hide");
    }
  }

  function showDragHandle() {
    if (dragHandleElement) {
      dragHandleElement.classList.remove("hide");
    }
  }

  return new Plugin({
    view: (view) => {
      dragHandleElement = document.createElement("div");
      dragHandleElement.draggable = true;
      dragHandleElement.dataset.dragHandle = "";
      dragHandleElement.classList.add("drag-handle");
      dragHandleElement.addEventListener("dragstart", (e) => {
        handleDragStart(e, view);
      });
      hideDragHandle();

      view?.dom?.parentElement?.appendChild(dragHandleElement);

      return {
        destroy: () => {
          dragHandleElement?.remove?.();
          dragHandleElement = null;
        },
      };
    },
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (!view.editable) {
            return;
          }

          const node = nodeDOMAtCoords({
            x: event.clientX + 50 + options.dragHandleWidth,
            y: event.clientY,
          });

          if (!(node instanceof Element)) {
            hideDragHandle();
            return;
          }

          const compStyle = window.getComputedStyle(node);
          const lineHeight = parseInt(compStyle.lineHeight, 10);
          const paddingTop = parseInt(compStyle.paddingTop, 10);

          const rect = absoluteRect(node);

          rect.top += (lineHeight - 24) / 2;
          rect.top += paddingTop;
          // Li markers
          if (node.matches("ul:not([data-type=taskList]) li, ol li")) {
            rect.left -= options.dragHandleWidth;
          }
          rect.width = options.dragHandleWidth;

          if (!dragHandleElement) return;

          dragHandleElement.style.left = `${rect.left - rect.width}px`;
          dragHandleElement.style.top = `${rect.top}px`;
          showDragHandle();
        },
        keydown: () => {
          hideDragHandle();
        },
        mousewheel: () => {
          hideDragHandle();
        },
        // dragging class is used for CSS
        dragstart: (view) => {
          view.dom.classList.add("dragging");
        },
        drop: (view, event) => {
          view.dom.classList.remove("dragging");
          hideDragHandle();
          let droppedNode: Node | null = null;
          const dropPos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });

          if (!dropPos) return;

          if (view.state.selection instanceof NodeSelection) {
            droppedNode = view.state.selection.node;
          }
          if (!droppedNode) return;

          const resolvedPos = view.state.doc.resolve(dropPos.pos);

          const isDroppedInsideList =
            resolvedPos.parent.type.name === "listItem";

          // If the selected node is a list item and is not dropped inside a list, we need to wrap it inside <ol> tag otherwise ol list items will be transformed into ul list item when dropped
          if (
            view.state.selection instanceof NodeSelection &&
            view.state.selection.node.type.name === "listItem" &&
            !isDroppedInsideList &&
            listType == "OL"
          ) {
            const text = droppedNode.textContent;
            if (!text) return;
            const paragraph = view.state.schema.nodes.paragraph.createAndFill(
              {},
              view.state.schema.text(text)
            );
            const listItem = view.state.schema.nodes.listItem.createAndFill(
              {},
              paragraph
            );

            const newList = view.state.schema.nodes.orderedList.createAndFill(
              null,
              listItem
            );
            const slice = new Slice(Fragment.from(newList), 0, 0);
            view.dragging = { slice, move: event.ctrlKey };
          }
        },
        dragend: (view) => {
          view.dom.classList.remove("dragging");
        },
      },
    },
  });
}

const DragHandle = Extension.create({
  name: "dragHandle",

  addProseMirrorPlugins() {
    return [
      DragHandleFunc({
        dragHandleWidth: 24,
      }),
    ];
  },
});

export default DragHandle;