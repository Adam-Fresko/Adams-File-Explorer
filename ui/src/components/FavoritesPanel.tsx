import { useState } from "react";
import { FolderHeartIcon, PlusIcon, Trash2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "./ui/alert-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger
} from "./ui/sidebar";
import { logUiEvent } from "../lib/eventLog";
import { useExplorerStore } from "../store/useExplorerStore";

export function FavoritesPanel() {
  const favorites = useExplorerStore((state) => state.favorites);
  const currentDir = useExplorerStore((state) => state.currentDir);
  const changeDirectory = useExplorerStore((state) => state.changeDirectory);
  const addFavorite = useExplorerStore((state) => state.addFavorite);
  const removeFavorite = useExplorerStore((state) => state.removeFavorite);
  const [favoriteToRemove, setFavoriteToRemove] = useState<string | null>(null);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);

  const closeRemoveDialog = () => {
    if (isConfirmingRemove) {
      return;
    }

    setFavoriteToRemove(null);
  };

  const confirmRemoveFavorite = async () => {
    if (!favoriteToRemove || isConfirmingRemove) {
      return;
    }

    const path = favoriteToRemove;
    setIsConfirmingRemove(true);
    logUiEvent({
      component: "FavoritesPanel",
      event_type: "favorite_remove_confirmed",
      paths: [path],
      target_dir: path
    });
    try {
      await removeFavorite(path);
      setFavoriteToRemove(null);
    } finally {
      setIsConfirmingRemove(false);
    }
  };

  return (
    <>
      <Sidebar id="favorites-sidebar" collapsible="icon" aria-label="Favorites sidebar">
        <SidebarHeader>
          <div className="flex items-center gap-2">
            <SidebarTrigger title="Toggle favorites" aria-label="Toggle favorites" />
            <div className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
              <FolderHeartIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="truncate text-sm font-medium">Favorites</span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Folders</SidebarGroupLabel>
            <SidebarGroupAction
              type="button"
              onClick={() => {
                logUiEvent({
                  component: "FavoritesPanel",
                  event_type: "favorite_add_clicked",
                  paths: [currentDir],
                  target_dir: currentDir
                });
                void addFavorite(currentDir);
              }}
              disabled={!currentDir}
              title="Add current folder"
              aria-label="Add current folder"
            >
              <PlusIcon />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {favorites.map((path) => (
                  <SidebarMenuItem key={path}>
                    <SidebarMenuButton
                      type="button"
                      onClick={() => {
                        logUiEvent({
                          component: "FavoritesPanel",
                          event_type: "favorite_open_clicked",
                          paths: [path],
                          target_dir: path
                        });
                        void changeDirectory(path);
                      }}
                      tooltip={path}
                      title={path}
                    >
                      <FolderHeartIcon className="text-muted-foreground" aria-hidden="true" />
                      <span className="truncate-left">{path}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      type="button"
                      showOnHover
                      onClick={() => {
                        logUiEvent({
                          component: "FavoritesPanel",
                          event_type: "favorite_remove_dialog_opened",
                          paths: [path],
                          target_dir: path
                        });
                        setFavoriteToRemove(path);
                      }}
                      title={`Remove favorite ${path}`}
                      aria-label={`Remove favorite ${path}`}
                    >
                      <Trash2Icon />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>

              {!favorites.length ? (
                <div className="px-2 py-6 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No favorites yet.
                </div>
              ) : null}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <AlertDialog
        open={!!favoriteToRemove}
        onOpenChange={(open) => {
          if (!open) {
            if (favoriteToRemove) {
              logUiEvent({
                component: "FavoritesPanel",
                event_type: "favorite_remove_dialog_closed",
                paths: [favoriteToRemove],
                target_dir: favoriteToRemove
              });
            }
            closeRemoveDialog();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove favorite?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the path from favorites only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
            {favoriteToRemove}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirmingRemove}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isConfirmingRemove}
              onClick={(event) => {
                event.preventDefault();
                void confirmRemoveFavorite();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
