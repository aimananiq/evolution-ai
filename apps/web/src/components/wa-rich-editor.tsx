"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useTheme } from "next-themes";
import EmojiPicker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Smile,
  ChevronDown,
  Braces,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { parseWhatsApp, serializeWhatsApp } from "@evo/wa-format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppRichEditorProps {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  variables?: { label: string; value: string }[];
  minRows?: number;
  disabled?: boolean;
  className?: string;
  /** Accessible name for the editing region (screen readers + test tooling). */
  ariaLabel?: string;
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        // Prevent editor from losing focus
        e.preventDefault();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-xs transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
        disabled && "pointer-events-none opacity-40"
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WhatsAppRichEditor({
  value,
  onChange,
  placeholder,
  variables,
  minRows = 3,
  disabled = false,
  className,
  ariaLabel,
}: WhatsAppRichEditorProps) {
  const { resolvedTheme } = useTheme();
  const lastEmitted = useRef<string>(value);
  // Keep a stable ref to onChange so the TipTap onUpdate closure (deps=[])
  // always calls the latest version without needing to recreate the editor.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showVarMenu, setShowVarMenu] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const varButtonRef = useRef<HTMLButtonElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const varMenuRef = useRef<HTMLDivElement>(null);

  // Approximate min-height from minRows: 1.5rem line-height + 2px borders
  const minHeight = `${minRows * 1.5}rem`;

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !disabled,
      editorProps: {
        attributes: {
          // Pass placeholder as a data attr on the contenteditable div so CSS can pick it up
          ...(placeholder ? { "data-placeholder": placeholder } : {}),
          // Accessible name + role so screen readers and test tooling can find the field
          role: "textbox",
          "aria-multiline": "true",
          ...(ariaLabel ? { "aria-label": ariaLabel } : placeholder ? { "aria-label": placeholder } : {}),
          class: "wa-prosemirror",
        },
      },
      extensions: [
        StarterKit.configure({
          // Disable unrepresentable formatting
          heading: false,
          horizontalRule: false,
          // Underline and link are not in WA format either
          underline: false,
          link: false,
          // Keep: paragraph, text, bold, italic, strike, code,
          // bulletList, orderedList, listItem, blockquote, codeBlock,
          // hardBreak, undoRedo (history)
          blockquote: {},
          bold: {},
          bulletList: {},
          code: {},
          codeBlock: {},
          hardBreak: {},
          italic: {},
          listItem: {},
          listKeymap: {},
          orderedList: {},
          paragraph: {},
          strike: {},
          undoRedo: {},
          dropcursor: {},
        }),
      ],
      content: parseWhatsApp(value),
      onUpdate({ editor: ed }) {
        const doc = ed.getJSON();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = serializeWhatsApp(doc as any);
        lastEmitted.current = text;
        onChangeRef.current(text);
      },
    },
    []
  );

  // Controlled value: sync external `value` into the editor when it changes
  // from outside (not from our own onUpdate emission). Guard the loop by
  // checking against `lastEmitted.current`.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    // External change — update editor without emitting onChange
    lastEmitted.current = value;
    editor.commands.setContent(parseWhatsApp(value), { emitUpdate: false });
  }, [editor, value]);

  // Update editable state
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Close emoji picker and var menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showVarMenu &&
        varMenuRef.current &&
        !varMenuRef.current.contains(e.target as Node) &&
        varButtonRef.current &&
        !varButtonRef.current.contains(e.target as Node)
      ) {
        setShowVarMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmojiPicker, showVarMenu]);

  // Toolbar command helpers
  const toggleBold = useCallback(() => editor?.chain().focus().toggleBold().run(), [editor]);
  const toggleItalic = useCallback(() => editor?.chain().focus().toggleItalic().run(), [editor]);
  const toggleStrike = useCallback(() => editor?.chain().focus().toggleStrike().run(), [editor]);
  const toggleCode = useCallback(() => editor?.chain().focus().toggleCode().run(), [editor]);
  const toggleBullet = useCallback(
    () => editor?.chain().focus().toggleBulletList().run(),
    [editor]
  );
  const toggleOrdered = useCallback(
    () => editor?.chain().focus().toggleOrderedList().run(),
    [editor]
  );
  const toggleBlockquote = useCallback(
    () => editor?.chain().focus().toggleBlockquote().run(),
    [editor]
  );

  // Insert emoji at cursor
  const handleEmojiSelect = useCallback(
    (emoji: { native: string }) => {
      if (!editor) return;
      editor.chain().focus().insertContent(emoji.native).run();
      setShowEmojiPicker(false);
    },
    [editor]
  );

  // Insert variable as plain text {{value}}
  const handleVariableSelect = useCallback(
    (varValue: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(`{{${varValue}}}`).run();
      setShowVarMenu(false);
    },
    [editor]
  );

  // Spintax: wrap selection as {selection|} or insert {|}
  const handleSpintax = useCallback(() => {
    if (!editor) return;
    const { state } = editor;
    const { from, to, empty } = state.selection;
    if (empty) {
      // Insert {|} with cursor between { and }
      editor.chain().focus().insertContent("{|}").run();
    } else {
      const selected = state.doc.textBetween(from, to);
      // Replace selection with {selected|} and place cursor after |
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent(`{${selected}|}`)
        .run();
    }
  }, [editor]);

  const isActive = (mark: string) => editor?.isActive(mark) ?? false;

  const emojiTheme = resolvedTheme === "light" ? "light" : "dark";

  return (
    <div
      className={cn(
        "wa-rich-editor rounded-md border border-input bg-card text-foreground",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0",
        disabled && "opacity-60 cursor-not-allowed",
        className
      )}
      // Callers often wrap this editor in a <label>; a label click would forward
      // focus to the first form control inside (the Bold button). Cancel that
      // default and route container clicks to the editor instead.
      onClick={(e) => {
        e.preventDefault();
        if (e.target === e.currentTarget && !disabled) editor?.commands.focus("end");
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Toolbar */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
        <ToolbarButton
          active={isActive("bold")}
          disabled={disabled}
          onClick={toggleBold}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarButton
          active={isActive("italic")}
          disabled={disabled}
          onClick={toggleItalic}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarButton
          active={isActive("strike")}
          disabled={disabled}
          onClick={toggleStrike}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarButton
          active={isActive("code")}
          disabled={disabled}
          onClick={toggleCode}
          title="Monospace"
        >
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" aria-hidden />

        <ToolbarButton
          active={isActive("bulletList")}
          disabled={disabled}
          onClick={toggleBullet}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarButton
          active={isActive("orderedList")}
          disabled={disabled}
          onClick={toggleOrdered}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarButton
          active={isActive("blockquote")}
          disabled={disabled}
          onClick={toggleBlockquote}
          title="Quote"
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" aria-hidden />

        {/* Spintax button */}
        <ToolbarButton
          disabled={disabled}
          onClick={handleSpintax}
          title="Spintax — wrap selection as {a|b}"
        >
          <Braces className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Emoji picker button */}
        <div className="relative">
          <button
            ref={emojiButtonRef}
            type="button"
            title="Insert emoji"
            disabled={disabled}
            aria-label="Insert emoji"
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) setShowEmojiPicker((v) => !v);
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded text-xs transition-colors",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
              showEmojiPicker && "bg-accent text-foreground",
              disabled && "pointer-events-none opacity-40"
            )}
          >
            <Smile className="h-3.5 w-3.5" />
          </button>

          {showEmojiPicker && (
            <div
              ref={emojiPickerRef}
              className="absolute left-0 top-full z-50 mt-1"
              // Prevent editor blur when clicking inside picker
              onMouseDown={(e) => e.preventDefault()}
            >
              <EmojiPicker
                data={emojiData}
                theme={emojiTheme}
                onEmojiSelect={handleEmojiSelect}
                previewPosition="none"
                skinTonePosition="none"
              />
            </div>
          )}
        </div>

        {/* Variables dropdown — only rendered when variables provided */}
        {variables && variables.length > 0 && (
          <div className="relative">
            <button
              ref={varButtonRef}
              type="button"
              title="Insert variable"
              disabled={disabled}
              aria-label="Insert variable"
              onMouseDown={(e) => {
                e.preventDefault();
                if (!disabled) setShowVarMenu((v) => !v);
              }}
              className={cn(
                "flex h-7 items-center gap-1 rounded px-1.5 text-xs transition-colors",
                "text-muted-foreground hover:bg-accent hover:text-foreground",
                showVarMenu && "bg-accent text-foreground",
                disabled && "pointer-events-none opacity-40"
              )}
            >
              <span>{"{{…}}"}</span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {showVarMenu && (
              <div
                ref={varMenuRef}
                className={cn(
                  "absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border",
                  "bg-popover text-popover-foreground shadow-md"
                )}
                onMouseDown={(e) => e.preventDefault()}
              >
                {variables.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    className={cn(
                      "block w-full px-3 py-1.5 text-left text-sm",
                      "hover:bg-accent hover:text-foreground"
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleVariableSelect(v.value);
                    }}
                  >
                    <span className="font-medium">{v.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {`{{${v.value}}}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Editor surface */}
      {/* ------------------------------------------------------------------ */}
      <EditorContent
        editor={editor}
        className="wa-rich-editor-content"
        style={{ minHeight }}
        data-placeholder={placeholder}
      />
    </div>
  );
}
