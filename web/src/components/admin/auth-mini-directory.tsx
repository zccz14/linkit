import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthMiniApi } from "auth-mini/sdk/browser";
import { toast } from "sonner";
import { useI18n } from "@/components/use-i18n";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

type DirectoryStatus = {
  configured: boolean;
  last_synced_at: number | null;
  user_count: number;
  last_error: string | null;
};

const endpoint = "/api/admin/auth-mini-directory";
const queryKey = ["admin", "auth-mini-directory"];

export function AuthMiniDirectory({ sdk }: { sdk: AuthMiniApi }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const status = useQuery({
    queryKey,
    queryFn: () => api<DirectoryStatus>(sdk, endpoint),
    refetchInterval: 30_000,
  });
  const updateStatus = (value: DirectoryStatus) => {
    queryClient.setQueryData(queryKey, value);
  };
  const save = useMutation({
    mutationFn: () =>
      api<DirectoryStatus>(sdk, endpoint, {
        method: "PUT",
        body: JSON.stringify({ token }),
      }),
    onSuccess: (value) => {
      setToken("");
      updateStatus(value);
      toast.success(t("directorySync.saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const sync = useMutation({
    mutationFn: () =>
      api<DirectoryStatus>(sdk, `${endpoint}/sync`, { method: "POST" }),
    onSuccess: (value) => {
      updateStatus(value);
      toast.success(t("directorySync.synced"));
    },
    onError: (error: Error) => {
      void queryClient.invalidateQueries({ queryKey });
      toast.error(error.message);
    },
  });
  const clear = useMutation({
    mutationFn: () => api<DirectoryStatus>(sdk, endpoint, { method: "DELETE" }),
    onSuccess: (value) => {
      setToken("");
      updateStatus(value);
      toast.success(t("directorySync.disabled"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const pending = save.isPending || sync.isPending || clear.isPending;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("directorySync.title")}</CardTitle>
          <CardDescription>{t("directorySync.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {t("directorySync.instructions")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("directorySync.boundary")}
          </p>
          {status.error ? <p role="alert">{status.error.message}</p> : null}
          <p>
            {status.isPending
              ? t("profile.loading")
              : t(
                  status.data?.configured
                    ? "directorySync.configured"
                    : "directorySync.unconfigured",
                )}
          </p>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="auth-mini-directory-token">
                {t("directorySync.token")}
              </FieldLabel>
              <Input
                id="auth-mini-directory-token"
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="am_uid_…"
                disabled={pending}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || !token.trim()}>
                {t("directorySync.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !status.data?.configured}
                onClick={() => sync.mutate()}
              >
                {t("directorySync.sync")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !status.data?.configured}
                onClick={() => {
                  if (window.confirm(t("directorySync.confirmClear")))
                    clear.mutate();
                }}
              >
                {t("directorySync.clear")}
              </Button>
            </div>
          </form>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">
                {t("directorySync.lastSync")}
              </dt>
              <dd>
                {status.data?.last_synced_at
                  ? new Date(status.data.last_synced_at * 1000).toLocaleString(
                      locale,
                    )
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("directorySync.userCount")}
              </dt>
              <dd>{status.data?.user_count ?? 0}</dd>
            </div>
          </dl>
          {status.data?.last_error ? (
            <p role="alert">{status.data.last_error}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
