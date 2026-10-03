import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/components/use-i18n";

export function ImagePreview({ src, name }: { src: string; name: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t("attachment.viewImage")}
        className="w-fit max-w-full cursor-zoom-in overflow-hidden rounded-md outline-none"
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={name}
          className="block max-h-80 max-w-full object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="bg-black/80" />
          <DialogPrimitive.Popup
            className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <DialogTitle className="sr-only">{name}</DialogTitle>
            <img
              src={src}
              alt={name}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3 right-3 text-white hover:bg-white/10 hover:text-white"
                />
              }
            >
              <XIcon />
              <span className="sr-only">{t("attachment.closeImage")}</span>
            </DialogClose>
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    </>
  );
}
