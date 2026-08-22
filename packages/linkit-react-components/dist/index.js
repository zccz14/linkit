"use client";
import ae, { createContext as se, useCallback as oe, useMemo as ie, useContext as le } from "react";
import { useAuthMini as ue } from "auth-mini-react-components";
import { clsx as S } from "clsx";
import { twMerge as U } from "tailwind-merge";
var P = { exports: {} }, T = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var q;
function ce() {
  if (q) return T;
  q = 1;
  var r = Symbol.for("react.transitional.element"), n = Symbol.for("react.fragment");
  function c(f, a, o) {
    var u = null;
    if (o !== void 0 && (u = "" + o), a.key !== void 0 && (u = "" + a.key), "key" in a) {
      o = {};
      for (var d in a)
        d !== "key" && (o[d] = a[d]);
    } else o = a;
    return a = o.ref, {
      $$typeof: r,
      type: f,
      key: u,
      ref: a !== void 0 ? a : null,
      props: o
    };
  }
  return T.Fragment = n, T.jsx = c, T.jsxs = c, T;
}
var g = {};
/**
 * @license React
 * react-jsx-runtime.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var W;
function fe() {
  return W || (W = 1, process.env.NODE_ENV !== "production" && (function() {
    function r(e) {
      if (e == null) return null;
      if (typeof e == "function")
        return e.$$typeof === re ? null : e.displayName || e.name || null;
      if (typeof e == "string") return e;
      switch (e) {
        case h:
          return "Fragment";
        case y:
          return "Profiler";
        case j:
          return "StrictMode";
        case Z:
          return "Suspense";
        case Q:
          return "SuspenseList";
        case ee:
          return "Activity";
      }
      if (typeof e == "object")
        switch (typeof e.tag == "number" && console.error(
          "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
        ), e.$$typeof) {
          case v:
            return "Portal";
          case X:
            return e.displayName || "Context";
          case B:
            return (e._context.displayName || "Context") + ".Consumer";
          case H:
            var t = e.render;
            return e = e.displayName, e || (e = t.displayName || t.name || "", e = e !== "" ? "ForwardRef(" + e + ")" : "ForwardRef"), e;
          case K:
            return t = e.displayName || null, t !== null ? t : r(e.type) || "Memo";
          case O:
            t = e._payload, e = e._init;
            try {
              return r(e(t));
            } catch {
            }
        }
      return null;
    }
    function n(e) {
      return "" + e;
    }
    function c(e) {
      try {
        n(e);
        var t = !1;
      } catch {
        t = !0;
      }
      if (t) {
        t = console;
        var s = t.error, i = typeof Symbol == "function" && Symbol.toStringTag && e[Symbol.toStringTag] || e.constructor.name || "Object";
        return s.call(
          t,
          "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
          i
        ), n(e);
      }
    }
    function f(e) {
      if (e === h) return "<>";
      if (typeof e == "object" && e !== null && e.$$typeof === O)
        return "<...>";
      try {
        var t = r(e);
        return t ? "<" + t + ">" : "<...>";
      } catch {
        return "<...>";
      }
    }
    function a() {
      var e = N.A;
      return e === null ? null : e.getOwner();
    }
    function o() {
      return Error("react-stack-top-frame");
    }
    function u(e) {
      if (Y.call(e, "key")) {
        var t = Object.getOwnPropertyDescriptor(e, "key").get;
        if (t && t.isReactWarning) return !1;
      }
      return e.key !== void 0;
    }
    function d(e, t) {
      function s() {
        z || (z = !0, console.error(
          "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
          t
        ));
      }
      s.isReactWarning = !0, Object.defineProperty(e, "key", {
        get: s,
        configurable: !0
      });
    }
    function k() {
      var e = r(this.type);
      return D[e] || (D[e] = !0, console.error(
        "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
      )), e = this.props.ref, e !== void 0 ? e : null;
    }
    function E(e, t, s, i, A, L) {
      var l = s.ref;
      return e = {
        $$typeof: w,
        type: e,
        key: t,
        props: s,
        _owner: i
      }, (l !== void 0 ? l : null) !== null ? Object.defineProperty(e, "ref", {
        enumerable: !1,
        get: k
      }) : Object.defineProperty(e, "ref", { enumerable: !1, value: null }), e._store = {}, Object.defineProperty(e._store, "validated", {
        configurable: !1,
        enumerable: !1,
        writable: !0,
        value: 0
      }), Object.defineProperty(e, "_debugInfo", {
        configurable: !1,
        enumerable: !1,
        writable: !0,
        value: null
      }), Object.defineProperty(e, "_debugStack", {
        configurable: !1,
        enumerable: !1,
        writable: !0,
        value: A
      }), Object.defineProperty(e, "_debugTask", {
        configurable: !1,
        enumerable: !1,
        writable: !0,
        value: L
      }), Object.freeze && (Object.freeze(e.props), Object.freeze(e)), e;
    }
    function b(e, t, s, i, A, L) {
      var l = t.children;
      if (l !== void 0)
        if (i)
          if (te(l)) {
            for (i = 0; i < l.length; i++)
              R(l[i]);
            Object.freeze && Object.freeze(l);
          } else
            console.error(
              "React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead."
            );
        else R(l);
      if (Y.call(t, "key")) {
        l = r(e);
        var x = Object.keys(t).filter(function(ne) {
          return ne !== "key";
        });
        i = 0 < x.length ? "{key: someKey, " + x.join(": ..., ") + ": ...}" : "{key: someKey}", F[l + i] || (x = 0 < x.length ? "{" + x.join(": ..., ") + ": ...}" : "{}", console.error(
          `A props object containing a "key" prop is being spread into JSX:
  let props = %s;
  <%s {...props} />
React keys must be passed directly to JSX without using spread:
  let props = %s;
  <%s key={someKey} {...props} />`,
          i,
          l,
          x,
          l
        ), F[l + i] = !0);
      }
      if (l = null, s !== void 0 && (c(s), l = "" + s), u(t) && (c(t.key), l = "" + t.key), "key" in t) {
        s = {};
        for (var $ in t)
          $ !== "key" && (s[$] = t[$]);
      } else s = t;
      return l && d(
        s,
        typeof e == "function" ? e.displayName || e.name || "Unknown" : e
      ), E(
        e,
        l,
        s,
        a(),
        A,
        L
      );
    }
    function R(e) {
      p(e) ? e._store && (e._store.validated = 1) : typeof e == "object" && e !== null && e.$$typeof === O && (e._payload.status === "fulfilled" ? p(e._payload.value) && e._payload.value._store && (e._payload.value._store.validated = 1) : e._store && (e._store.validated = 1));
    }
    function p(e) {
      return typeof e == "object" && e !== null && e.$$typeof === w;
    }
    var _ = ae, w = Symbol.for("react.transitional.element"), v = Symbol.for("react.portal"), h = Symbol.for("react.fragment"), j = Symbol.for("react.strict_mode"), y = Symbol.for("react.profiler"), B = Symbol.for("react.consumer"), X = Symbol.for("react.context"), H = Symbol.for("react.forward_ref"), Z = Symbol.for("react.suspense"), Q = Symbol.for("react.suspense_list"), K = Symbol.for("react.memo"), O = Symbol.for("react.lazy"), ee = Symbol.for("react.activity"), re = Symbol.for("react.client.reference"), N = _.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, Y = Object.prototype.hasOwnProperty, te = Array.isArray, C = console.createTask ? console.createTask : function() {
      return null;
    };
    _ = {
      react_stack_bottom_frame: function(e) {
        return e();
      }
    };
    var z, D = {}, M = _.react_stack_bottom_frame.bind(
      _,
      o
    )(), I = C(f(o)), F = {};
    g.Fragment = h, g.jsx = function(e, t, s) {
      var i = 1e4 > N.recentlyCreatedOwnerStacks++;
      return b(
        e,
        t,
        s,
        !1,
        i ? Error("react-stack-top-frame") : M,
        i ? C(f(e)) : I
      );
    }, g.jsxs = function(e, t, s) {
      var i = 1e4 > N.recentlyCreatedOwnerStacks++;
      return b(
        e,
        t,
        s,
        !0,
        i ? Error("react-stack-top-frame") : M,
        i ? C(f(e)) : I
      );
    };
  })()), g;
}
var G;
function me() {
  return G || (G = 1, process.env.NODE_ENV === "production" ? P.exports = ce() : P.exports = fe()), P.exports;
}
var m = me();
const J = se(void 0);
function ve({ linkitBaseUrl: r, children: n }) {
  let c;
  try {
    c = ue();
  } catch {
    throw new Error("LinkitProvider must be rendered inside AuthMiniProvider.");
  }
  const f = de(r), a = oe(async (u, d = {}) => {
    var R;
    const k = be(f, u), E = async (p) => {
      var h, j, y;
      const _ = (h = c.sdk) == null ? void 0 : h.session.getState(), w = p ? (y = await ((j = c.sdk) == null ? void 0 : j.session.refresh())) == null ? void 0 : y.accessToken : _ == null ? void 0 : _.accessToken;
      if (!w) throw new Error("Linkit requires an authenticated Auth Mini session.");
      const v = new Headers(d.headers);
      return v.set("Authorization", `Bearer ${w}`), d.body && !(d.body instanceof FormData) && !v.has("Content-Type") && v.set("Content-Type", "application/json"), fetch(k, { ...d, headers: v });
    };
    let b = await E(!1);
    if (b.status === 401 && (b = await E(!0)), !b.ok) {
      const p = await b.json().catch(() => {
      });
      throw new Error(((R = p == null ? void 0 : p.error) == null ? void 0 : R.message) ?? `Linkit request failed (${b.status}).`);
    }
    if (b.status !== 204)
      return await b.json();
  }, [c.sdk, f]), o = ie(() => ({
    linkitBaseUrl: f,
    request: a,
    getMe: () => a("/api/me"),
    getProfile: (u) => a(`/api/public/profiles/${encodeURIComponent(u)}`)
  }), [f, a]);
  return /* @__PURE__ */ m.jsx(J.Provider, { value: o, children: n });
}
function he() {
  const r = le(J);
  if (!r) throw new Error("useLinkit must be used within LinkitProvider.");
  return r;
}
function de(r) {
  const n = new URL(r);
  if (n.protocol !== "https:" && n.protocol !== "http:") throw new Error("linkitBaseUrl must use HTTP(S).");
  return n.pathname = n.pathname.replace(/\/$/, ""), n.search = "", n.hash = "", n.toString().replace(/\/$/, "");
}
function be(r, n) {
  if (!n.startsWith("/")) throw new Error("Linkit request paths must begin with '/'.");
  return new URL(n, `${r}/`).toString();
}
function V({ profile: r, size: n = "md", fallback: c, className: f, ...a }) {
  var k, E;
  const o = ((k = r == null ? void 0 : r.display_name) == null ? void 0 : k.trim()) || c || "?", u = ((E = Array.from(o)[0]) == null ? void 0 : E.toLocaleUpperCase()) ?? "?", d = n === "sm" ? "size-6 text-[0.65rem]" : n === "lg" ? "size-10 text-base" : "size-7 text-xs";
  return /* @__PURE__ */ m.jsx("span", { className: U(S("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground", d, f)), "aria-label": o, children: r != null && r.avatar_url ? /* @__PURE__ */ m.jsx("img", { ...a, className: "size-full object-cover", src: r.avatar_url, alt: "" }) : u });
}
function xe({ profile: r, userId: n, compact: c = !1, showUsername: f = !1, className: a, ...o }) {
  const u = (r == null ? void 0 : r.display_name) || n || "Unknown user";
  return /* @__PURE__ */ m.jsxs("span", { ...o, className: U(S("inline-flex min-w-0 items-center gap-2", a)), children: [
    /* @__PURE__ */ m.jsx(V, { profile: r, size: c ? "sm" : "md", fallback: u }),
    /* @__PURE__ */ m.jsxs("span", { className: "min-w-0", children: [
      /* @__PURE__ */ m.jsx("span", { className: "block truncate font-medium", children: u }),
      f && (r != null && r.username) ? /* @__PURE__ */ m.jsxs("span", { className: "block truncate text-xs text-muted-foreground", children: [
        "@",
        r.username
      ] }) : null
    ] })
  ] });
}
function Re({ conversation: r, compact: n = !1, className: c, ...f }) {
  var u;
  const a = r.kind === "group", o = a ? r.title || "Group" : ((u = r.counterpart) == null ? void 0 : u.display_name) || r.title || "Direct message";
  return /* @__PURE__ */ m.jsxs("span", { ...f, className: U(S("inline-flex min-w-0 items-center gap-2", c)), children: [
    a ? /* @__PURE__ */ m.jsx("span", { className: S("inline-grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground", n ? "size-6 text-[0.6rem]" : "size-7 text-[0.7rem]"), children: r.avatar_url ? /* @__PURE__ */ m.jsx("img", { className: "size-full rounded-full object-cover", src: r.avatar_url, alt: "" }) : "#" }) : /* @__PURE__ */ m.jsx(V, { profile: r.counterpart, size: n ? "sm" : "md", fallback: o }),
    /* @__PURE__ */ m.jsxs("span", { className: "min-w-0", children: [
      /* @__PURE__ */ m.jsx("span", { className: "block truncate font-medium", children: o }),
      !n && a ? /* @__PURE__ */ m.jsx("span", { className: "block text-xs text-muted-foreground", children: "Group" }) : null
    ] })
  ] });
}
export {
  V as LinkitAvatar,
  Re as LinkitConversationDisplay,
  ve as LinkitProvider,
  xe as LinkitUserDisplay,
  he as useLinkit
};
