const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./Dashboard-DzOGGc2C.js","./card-CJejDjrN.js","./trending-up-BnM90KHz.js","./minus-D8cNH9y7.js","./localDay-CzWGkYP0.js","./coins-B2YPUoKF.js","./plus-CRYwvOZy.js","./database-CgRqZ2QH.js","./PageHeader-Uo_aLgRN.js","./chevron-left-DjwtYoGs.js","./refresh-cw-BZLwpUhy.js","./circle-check-big-DAvcYbdn.js","./users-ZQtKFulg.js","./Providers-BBqbedF7.js","./label-BqQAqSEG.js","./select-DfPABgRe.js","./tabs-Cs4ul3yp.js","./search-FGE6QrPq.js","./download-bdv0hDXt.js","./badge-CrPFCp-Q.js","./arrow-right-CWAKfkrF.js","./loader-circle-nOv8zGof.js","./rotate-ccw-QvuFi60u.js","./circle-alert-BOs73daR.js","./eye-BdblIIb5.js","./textarea-EvAre4Ih.js","./user-DI5gSxfj.js","./circle-x-CO4cGxfI.js","./chart-column-BORE439i.js","./table-DXILV6XS.js","./alert-BDeGQ5C8.js","./Aggregate-CU247JL8.js","./CatalogScopeBatchButton-CyDc-H3J.js","./ModelAnnotationDialog-D1MW0Y2K.js","./aggregateCost-B41jA_HQ.js","./shield-check-B8lc84eC.js","./Channels-BKn7nhJI.js","./channels-Ck20oZNV.js","./ProxySettings-DWGoJfSX.js","./slider-Bx20ZX66.js","./shield-C_BXUSe3.js","./Models-zPHr6guu.js","./Gateways-lZ9U73xs.js","./Logs-DmHG7Sr8.js","./globe-Cj-vljgr.js","./Settings-Cz0rtoCJ.js"])))=>i.map(i=>d[i]);
function _mergeNamespaces(n2, m2) {
  for (var i = 0; i < m2.length; i++) {
    const e = m2[i];
    if (typeof e !== "string" && !Array.isArray(e)) {
      for (const k2 in e) {
        if (k2 !== "default" && !(k2 in n2)) {
          const d = Object.getOwnPropertyDescriptor(e, k2);
          if (d) {
            Object.defineProperty(n2, k2, d.get ? d : {
              enumerable: true,
              get: () => e[k2]
            });
          }
        }
      }
    }
  }
  return Object.freeze(Object.defineProperty(n2, Symbol.toStringTag, { value: "Module" }));
}
function getDefaultExportFromCjs(x2) {
  return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
}
var jsxRuntime = { exports: {} };
var reactJsxRuntime_production_min = {};
var react = { exports: {} };
var react_production_min = {};
/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var l$1 = Symbol.for("react.element"), n$1 = Symbol.for("react.portal"), p$2 = Symbol.for("react.fragment"), q$1 = Symbol.for("react.strict_mode"), r$1 = Symbol.for("react.profiler"), t = Symbol.for("react.provider"), u = Symbol.for("react.context"), v$1 = Symbol.for("react.forward_ref"), w = Symbol.for("react.suspense"), x = Symbol.for("react.memo"), y = Symbol.for("react.lazy"), z$1 = Symbol.iterator;
function A$1(a) {
  if (null === a || "object" !== typeof a) return null;
  a = z$1 && a[z$1] || a["@@iterator"];
  return "function" === typeof a ? a : null;
}
var B$1 = { isMounted: function() {
  return false;
}, enqueueForceUpdate: function() {
}, enqueueReplaceState: function() {
}, enqueueSetState: function() {
} }, C$1 = Object.assign, D$1 = {};
function E$1(a, b, e) {
  this.props = a;
  this.context = b;
  this.refs = D$1;
  this.updater = e || B$1;
}
E$1.prototype.isReactComponent = {};
E$1.prototype.setState = function(a, b) {
  if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
  this.updater.enqueueSetState(this, a, b, "setState");
};
E$1.prototype.forceUpdate = function(a) {
  this.updater.enqueueForceUpdate(this, a, "forceUpdate");
};
function F() {
}
F.prototype = E$1.prototype;
function G$1(a, b, e) {
  this.props = a;
  this.context = b;
  this.refs = D$1;
  this.updater = e || B$1;
}
var H$1 = G$1.prototype = new F();
H$1.constructor = G$1;
C$1(H$1, E$1.prototype);
H$1.isPureReactComponent = true;
var I$1 = Array.isArray, J = Object.prototype.hasOwnProperty, K$1 = { current: null }, L$1 = { key: true, ref: true, __self: true, __source: true };
function M$1(a, b, e) {
  var d, c = {}, k2 = null, h = null;
  if (null != b) for (d in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k2 = "" + b.key), b) J.call(b, d) && !L$1.hasOwnProperty(d) && (c[d] = b[d]);
  var g = arguments.length - 2;
  if (1 === g) c.children = e;
  else if (1 < g) {
    for (var f2 = Array(g), m2 = 0; m2 < g; m2++) f2[m2] = arguments[m2 + 2];
    c.children = f2;
  }
  if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
  return { $$typeof: l$1, type: a, key: k2, ref: h, props: c, _owner: K$1.current };
}
function N$1(a, b) {
  return { $$typeof: l$1, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
}
function O$1(a) {
  return "object" === typeof a && null !== a && a.$$typeof === l$1;
}
function escape$1(a) {
  var b = { "=": "=0", ":": "=2" };
  return "$" + a.replace(/[=:]/g, function(a2) {
    return b[a2];
  });
}
var P$1 = /\/+/g;
function Q$1(a, b) {
  return "object" === typeof a && null !== a && null != a.key ? escape$1("" + a.key) : b.toString(36);
}
function R$1(a, b, e, d, c) {
  var k2 = typeof a;
  if ("undefined" === k2 || "boolean" === k2) a = null;
  var h = false;
  if (null === a) h = true;
  else switch (k2) {
    case "string":
    case "number":
      h = true;
      break;
    case "object":
      switch (a.$$typeof) {
        case l$1:
        case n$1:
          h = true;
      }
  }
  if (h) return h = a, c = c(h), a = "" === d ? "." + Q$1(h, 0) : d, I$1(c) ? (e = "", null != a && (e = a.replace(P$1, "$&/") + "/"), R$1(c, b, e, "", function(a2) {
    return a2;
  })) : null != c && (O$1(c) && (c = N$1(c, e + (!c.key || h && h.key === c.key ? "" : ("" + c.key).replace(P$1, "$&/") + "/") + a)), b.push(c)), 1;
  h = 0;
  d = "" === d ? "." : d + ":";
  if (I$1(a)) for (var g = 0; g < a.length; g++) {
    k2 = a[g];
    var f2 = d + Q$1(k2, g);
    h += R$1(k2, b, e, f2, c);
  }
  else if (f2 = A$1(a), "function" === typeof f2) for (a = f2.call(a), g = 0; !(k2 = a.next()).done; ) k2 = k2.value, f2 = d + Q$1(k2, g++), h += R$1(k2, b, e, f2, c);
  else if ("object" === k2) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
  return h;
}
function S$1(a, b, e) {
  if (null == a) return a;
  var d = [], c = 0;
  R$1(a, d, "", "", function(a2) {
    return b.call(e, a2, c++);
  });
  return d;
}
function T$1(a) {
  if (-1 === a._status) {
    var b = a._result;
    b = b();
    b.then(function(b2) {
      if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
    }, function(b2) {
      if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
    });
    -1 === a._status && (a._status = 0, a._result = b);
  }
  if (1 === a._status) return a._result.default;
  throw a._result;
}
var U$1 = { current: null }, V$1 = { transition: null }, W$1 = { ReactCurrentDispatcher: U$1, ReactCurrentBatchConfig: V$1, ReactCurrentOwner: K$1 };
function X$2() {
  throw Error("act(...) is not supported in production builds of React.");
}
react_production_min.Children = { map: S$1, forEach: function(a, b, e) {
  S$1(a, function() {
    b.apply(this, arguments);
  }, e);
}, count: function(a) {
  var b = 0;
  S$1(a, function() {
    b++;
  });
  return b;
}, toArray: function(a) {
  return S$1(a, function(a2) {
    return a2;
  }) || [];
}, only: function(a) {
  if (!O$1(a)) throw Error("React.Children.only expected to receive a single React element child.");
  return a;
} };
react_production_min.Component = E$1;
react_production_min.Fragment = p$2;
react_production_min.Profiler = r$1;
react_production_min.PureComponent = G$1;
react_production_min.StrictMode = q$1;
react_production_min.Suspense = w;
react_production_min.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W$1;
react_production_min.act = X$2;
react_production_min.cloneElement = function(a, b, e) {
  if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
  var d = C$1({}, a.props), c = a.key, k2 = a.ref, h = a._owner;
  if (null != b) {
    void 0 !== b.ref && (k2 = b.ref, h = K$1.current);
    void 0 !== b.key && (c = "" + b.key);
    if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
    for (f2 in b) J.call(b, f2) && !L$1.hasOwnProperty(f2) && (d[f2] = void 0 === b[f2] && void 0 !== g ? g[f2] : b[f2]);
  }
  var f2 = arguments.length - 2;
  if (1 === f2) d.children = e;
  else if (1 < f2) {
    g = Array(f2);
    for (var m2 = 0; m2 < f2; m2++) g[m2] = arguments[m2 + 2];
    d.children = g;
  }
  return { $$typeof: l$1, type: a.type, key: c, ref: k2, props: d, _owner: h };
};
react_production_min.createContext = function(a) {
  a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
  a.Provider = { $$typeof: t, _context: a };
  return a.Consumer = a;
};
react_production_min.createElement = M$1;
react_production_min.createFactory = function(a) {
  var b = M$1.bind(null, a);
  b.type = a;
  return b;
};
react_production_min.createRef = function() {
  return { current: null };
};
react_production_min.forwardRef = function(a) {
  return { $$typeof: v$1, render: a };
};
react_production_min.isValidElement = O$1;
react_production_min.lazy = function(a) {
  return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T$1 };
};
react_production_min.memo = function(a, b) {
  return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
};
react_production_min.startTransition = function(a) {
  var b = V$1.transition;
  V$1.transition = {};
  try {
    a();
  } finally {
    V$1.transition = b;
  }
};
react_production_min.unstable_act = X$2;
react_production_min.useCallback = function(a, b) {
  return U$1.current.useCallback(a, b);
};
react_production_min.useContext = function(a) {
  return U$1.current.useContext(a);
};
react_production_min.useDebugValue = function() {
};
react_production_min.useDeferredValue = function(a) {
  return U$1.current.useDeferredValue(a);
};
react_production_min.useEffect = function(a, b) {
  return U$1.current.useEffect(a, b);
};
react_production_min.useId = function() {
  return U$1.current.useId();
};
react_production_min.useImperativeHandle = function(a, b, e) {
  return U$1.current.useImperativeHandle(a, b, e);
};
react_production_min.useInsertionEffect = function(a, b) {
  return U$1.current.useInsertionEffect(a, b);
};
react_production_min.useLayoutEffect = function(a, b) {
  return U$1.current.useLayoutEffect(a, b);
};
react_production_min.useMemo = function(a, b) {
  return U$1.current.useMemo(a, b);
};
react_production_min.useReducer = function(a, b, e) {
  return U$1.current.useReducer(a, b, e);
};
react_production_min.useRef = function(a) {
  return U$1.current.useRef(a);
};
react_production_min.useState = function(a) {
  return U$1.current.useState(a);
};
react_production_min.useSyncExternalStore = function(a, b, e) {
  return U$1.current.useSyncExternalStore(a, b, e);
};
react_production_min.useTransition = function() {
  return U$1.current.useTransition();
};
react_production_min.version = "18.3.1";
{
  react.exports = react_production_min;
}
var reactExports = react.exports;
const React$1 = /* @__PURE__ */ getDefaultExportFromCjs(reactExports);
const React$2 = /* @__PURE__ */ _mergeNamespaces({
  __proto__: null,
  default: React$1
}, [reactExports]);
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var f = reactExports, k = Symbol.for("react.element"), l = Symbol.for("react.fragment"), m$1 = Object.prototype.hasOwnProperty, n = f.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, p$1 = { key: true, ref: true, __self: true, __source: true };
function q(c, a, g) {
  var b, d = {}, e = null, h = null;
  void 0 !== g && (e = "" + g);
  void 0 !== a.key && (e = "" + a.key);
  void 0 !== a.ref && (h = a.ref);
  for (b in a) m$1.call(a, b) && !p$1.hasOwnProperty(b) && (d[b] = a[b]);
  if (c && c.defaultProps) for (b in a = c.defaultProps, a) void 0 === d[b] && (d[b] = a[b]);
  return { $$typeof: k, type: c, key: e, ref: h, props: d, _owner: n.current };
}
reactJsxRuntime_production_min.Fragment = l;
reactJsxRuntime_production_min.jsx = q;
reactJsxRuntime_production_min.jsxs = q;
{
  jsxRuntime.exports = reactJsxRuntime_production_min;
}
var jsxRuntimeExports = jsxRuntime.exports;
var client = {};
var reactDom = { exports: {} };
var reactDom_production_min = {};
var scheduler = { exports: {} };
var scheduler_production_min = {};
/**
 * @license React
 * scheduler.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
(function(exports$1) {
  function f2(a, b) {
    var c = a.length;
    a.push(b);
    a: for (; 0 < c; ) {
      var d = c - 1 >>> 1, e = a[d];
      if (0 < g(e, b)) a[d] = b, a[c] = e, c = d;
      else break a;
    }
  }
  function h(a) {
    return 0 === a.length ? null : a[0];
  }
  function k2(a) {
    if (0 === a.length) return null;
    var b = a[0], c = a.pop();
    if (c !== b) {
      a[0] = c;
      a: for (var d = 0, e = a.length, w2 = e >>> 1; d < w2; ) {
        var m2 = 2 * (d + 1) - 1, C2 = a[m2], n2 = m2 + 1, x2 = a[n2];
        if (0 > g(C2, c)) n2 < e && 0 > g(x2, C2) ? (a[d] = x2, a[n2] = c, d = n2) : (a[d] = C2, a[m2] = c, d = m2);
        else if (n2 < e && 0 > g(x2, c)) a[d] = x2, a[n2] = c, d = n2;
        else break a;
      }
    }
    return b;
  }
  function g(a, b) {
    var c = a.sortIndex - b.sortIndex;
    return 0 !== c ? c : a.id - b.id;
  }
  if ("object" === typeof performance && "function" === typeof performance.now) {
    var l2 = performance;
    exports$1.unstable_now = function() {
      return l2.now();
    };
  } else {
    var p2 = Date, q2 = p2.now();
    exports$1.unstable_now = function() {
      return p2.now() - q2;
    };
  }
  var r2 = [], t2 = [], u2 = 1, v2 = null, y2 = 3, z2 = false, A2 = false, B2 = false, D2 = "function" === typeof setTimeout ? setTimeout : null, E2 = "function" === typeof clearTimeout ? clearTimeout : null, F2 = "undefined" !== typeof setImmediate ? setImmediate : null;
  "undefined" !== typeof navigator && void 0 !== navigator.scheduling && void 0 !== navigator.scheduling.isInputPending && navigator.scheduling.isInputPending.bind(navigator.scheduling);
  function G2(a) {
    for (var b = h(t2); null !== b; ) {
      if (null === b.callback) k2(t2);
      else if (b.startTime <= a) k2(t2), b.sortIndex = b.expirationTime, f2(r2, b);
      else break;
      b = h(t2);
    }
  }
  function H2(a) {
    B2 = false;
    G2(a);
    if (!A2) if (null !== h(r2)) A2 = true, I2(J2);
    else {
      var b = h(t2);
      null !== b && K2(H2, b.startTime - a);
    }
  }
  function J2(a, b) {
    A2 = false;
    B2 && (B2 = false, E2(L2), L2 = -1);
    z2 = true;
    var c = y2;
    try {
      G2(b);
      for (v2 = h(r2); null !== v2 && (!(v2.expirationTime > b) || a && !M2()); ) {
        var d = v2.callback;
        if ("function" === typeof d) {
          v2.callback = null;
          y2 = v2.priorityLevel;
          var e = d(v2.expirationTime <= b);
          b = exports$1.unstable_now();
          "function" === typeof e ? v2.callback = e : v2 === h(r2) && k2(r2);
          G2(b);
        } else k2(r2);
        v2 = h(r2);
      }
      if (null !== v2) var w2 = true;
      else {
        var m2 = h(t2);
        null !== m2 && K2(H2, m2.startTime - b);
        w2 = false;
      }
      return w2;
    } finally {
      v2 = null, y2 = c, z2 = false;
    }
  }
  var N2 = false, O2 = null, L2 = -1, P2 = 5, Q2 = -1;
  function M2() {
    return exports$1.unstable_now() - Q2 < P2 ? false : true;
  }
  function R2() {
    if (null !== O2) {
      var a = exports$1.unstable_now();
      Q2 = a;
      var b = true;
      try {
        b = O2(true, a);
      } finally {
        b ? S2() : (N2 = false, O2 = null);
      }
    } else N2 = false;
  }
  var S2;
  if ("function" === typeof F2) S2 = function() {
    F2(R2);
  };
  else if ("undefined" !== typeof MessageChannel) {
    var T2 = new MessageChannel(), U2 = T2.port2;
    T2.port1.onmessage = R2;
    S2 = function() {
      U2.postMessage(null);
    };
  } else S2 = function() {
    D2(R2, 0);
  };
  function I2(a) {
    O2 = a;
    N2 || (N2 = true, S2());
  }
  function K2(a, b) {
    L2 = D2(function() {
      a(exports$1.unstable_now());
    }, b);
  }
  exports$1.unstable_IdlePriority = 5;
  exports$1.unstable_ImmediatePriority = 1;
  exports$1.unstable_LowPriority = 4;
  exports$1.unstable_NormalPriority = 3;
  exports$1.unstable_Profiling = null;
  exports$1.unstable_UserBlockingPriority = 2;
  exports$1.unstable_cancelCallback = function(a) {
    a.callback = null;
  };
  exports$1.unstable_continueExecution = function() {
    A2 || z2 || (A2 = true, I2(J2));
  };
  exports$1.unstable_forceFrameRate = function(a) {
    0 > a || 125 < a ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : P2 = 0 < a ? Math.floor(1e3 / a) : 5;
  };
  exports$1.unstable_getCurrentPriorityLevel = function() {
    return y2;
  };
  exports$1.unstable_getFirstCallbackNode = function() {
    return h(r2);
  };
  exports$1.unstable_next = function(a) {
    switch (y2) {
      case 1:
      case 2:
      case 3:
        var b = 3;
        break;
      default:
        b = y2;
    }
    var c = y2;
    y2 = b;
    try {
      return a();
    } finally {
      y2 = c;
    }
  };
  exports$1.unstable_pauseExecution = function() {
  };
  exports$1.unstable_requestPaint = function() {
  };
  exports$1.unstable_runWithPriority = function(a, b) {
    switch (a) {
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
        break;
      default:
        a = 3;
    }
    var c = y2;
    y2 = a;
    try {
      return b();
    } finally {
      y2 = c;
    }
  };
  exports$1.unstable_scheduleCallback = function(a, b, c) {
    var d = exports$1.unstable_now();
    "object" === typeof c && null !== c ? (c = c.delay, c = "number" === typeof c && 0 < c ? d + c : d) : c = d;
    switch (a) {
      case 1:
        var e = -1;
        break;
      case 2:
        e = 250;
        break;
      case 5:
        e = 1073741823;
        break;
      case 4:
        e = 1e4;
        break;
      default:
        e = 5e3;
    }
    e = c + e;
    a = { id: u2++, callback: b, priorityLevel: a, startTime: c, expirationTime: e, sortIndex: -1 };
    c > d ? (a.sortIndex = c, f2(t2, a), null === h(r2) && a === h(t2) && (B2 ? (E2(L2), L2 = -1) : B2 = true, K2(H2, c - d))) : (a.sortIndex = e, f2(r2, a), A2 || z2 || (A2 = true, I2(J2)));
    return a;
  };
  exports$1.unstable_shouldYield = M2;
  exports$1.unstable_wrapCallback = function(a) {
    var b = y2;
    return function() {
      var c = y2;
      y2 = b;
      try {
        return a.apply(this, arguments);
      } finally {
        y2 = c;
      }
    };
  };
})(scheduler_production_min);
{
  scheduler.exports = scheduler_production_min;
}
var schedulerExports = scheduler.exports;
/**
 * @license React
 * react-dom.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var aa = reactExports, ca = schedulerExports;
function p(a) {
  for (var b = "https://reactjs.org/docs/error-decoder.html?invariant=" + a, c = 1; c < arguments.length; c++) b += "&args[]=" + encodeURIComponent(arguments[c]);
  return "Minified React error #" + a + "; visit " + b + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
}
var da = /* @__PURE__ */ new Set(), ea = {};
function fa(a, b) {
  ha(a, b);
  ha(a + "Capture", b);
}
function ha(a, b) {
  ea[a] = b;
  for (a = 0; a < b.length; a++) da.add(b[a]);
}
var ia = !("undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement), ja = Object.prototype.hasOwnProperty, ka = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/, la = {}, ma = {};
function oa(a) {
  if (ja.call(ma, a)) return true;
  if (ja.call(la, a)) return false;
  if (ka.test(a)) return ma[a] = true;
  la[a] = true;
  return false;
}
function pa(a, b, c, d) {
  if (null !== c && 0 === c.type) return false;
  switch (typeof b) {
    case "function":
    case "symbol":
      return true;
    case "boolean":
      if (d) return false;
      if (null !== c) return !c.acceptsBooleans;
      a = a.toLowerCase().slice(0, 5);
      return "data-" !== a && "aria-" !== a;
    default:
      return false;
  }
}
function qa(a, b, c, d) {
  if (null === b || "undefined" === typeof b || pa(a, b, c, d)) return true;
  if (d) return false;
  if (null !== c) switch (c.type) {
    case 3:
      return !b;
    case 4:
      return false === b;
    case 5:
      return isNaN(b);
    case 6:
      return isNaN(b) || 1 > b;
  }
  return false;
}
function v(a, b, c, d, e, f2, g) {
  this.acceptsBooleans = 2 === b || 3 === b || 4 === b;
  this.attributeName = d;
  this.attributeNamespace = e;
  this.mustUseProperty = c;
  this.propertyName = a;
  this.type = b;
  this.sanitizeURL = f2;
  this.removeEmptyString = g;
}
var z = {};
"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(a) {
  z[a] = new v(a, 0, false, a, null, false, false);
});
[["acceptCharset", "accept-charset"], ["className", "class"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"]].forEach(function(a) {
  var b = a[0];
  z[b] = new v(b, 1, false, a[1], null, false, false);
});
["contentEditable", "draggable", "spellCheck", "value"].forEach(function(a) {
  z[a] = new v(a, 2, false, a.toLowerCase(), null, false, false);
});
["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function(a) {
  z[a] = new v(a, 2, false, a, null, false, false);
});
"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(a) {
  z[a] = new v(a, 3, false, a.toLowerCase(), null, false, false);
});
["checked", "multiple", "muted", "selected"].forEach(function(a) {
  z[a] = new v(a, 3, true, a, null, false, false);
});
["capture", "download"].forEach(function(a) {
  z[a] = new v(a, 4, false, a, null, false, false);
});
["cols", "rows", "size", "span"].forEach(function(a) {
  z[a] = new v(a, 6, false, a, null, false, false);
});
["rowSpan", "start"].forEach(function(a) {
  z[a] = new v(a, 5, false, a.toLowerCase(), null, false, false);
});
var ra = /[\-:]([a-z])/g;
function sa(a) {
  return a[1].toUpperCase();
}
"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(a) {
  var b = a.replace(
    ra,
    sa
  );
  z[b] = new v(b, 1, false, a, null, false, false);
});
"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(a) {
  var b = a.replace(ra, sa);
  z[b] = new v(b, 1, false, a, "http://www.w3.org/1999/xlink", false, false);
});
["xml:base", "xml:lang", "xml:space"].forEach(function(a) {
  var b = a.replace(ra, sa);
  z[b] = new v(b, 1, false, a, "http://www.w3.org/XML/1998/namespace", false, false);
});
["tabIndex", "crossOrigin"].forEach(function(a) {
  z[a] = new v(a, 1, false, a.toLowerCase(), null, false, false);
});
z.xlinkHref = new v("xlinkHref", 1, false, "xlink:href", "http://www.w3.org/1999/xlink", true, false);
["src", "href", "action", "formAction"].forEach(function(a) {
  z[a] = new v(a, 1, false, a.toLowerCase(), null, true, true);
});
function ta(a, b, c, d) {
  var e = z.hasOwnProperty(b) ? z[b] : null;
  if (null !== e ? 0 !== e.type : d || !(2 < b.length) || "o" !== b[0] && "O" !== b[0] || "n" !== b[1] && "N" !== b[1]) qa(b, c, e, d) && (c = null), d || null === e ? oa(b) && (null === c ? a.removeAttribute(b) : a.setAttribute(b, "" + c)) : e.mustUseProperty ? a[e.propertyName] = null === c ? 3 === e.type ? false : "" : c : (b = e.attributeName, d = e.attributeNamespace, null === c ? a.removeAttribute(b) : (e = e.type, c = 3 === e || 4 === e && true === c ? "" : "" + c, d ? a.setAttributeNS(d, b, c) : a.setAttribute(b, c)));
}
var ua = aa.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, va = Symbol.for("react.element"), wa = Symbol.for("react.portal"), ya = Symbol.for("react.fragment"), za = Symbol.for("react.strict_mode"), Aa = Symbol.for("react.profiler"), Ba = Symbol.for("react.provider"), Ca = Symbol.for("react.context"), Da = Symbol.for("react.forward_ref"), Ea = Symbol.for("react.suspense"), Fa = Symbol.for("react.suspense_list"), Ga = Symbol.for("react.memo"), Ha = Symbol.for("react.lazy");
var Ia = Symbol.for("react.offscreen");
var Ja = Symbol.iterator;
function Ka(a) {
  if (null === a || "object" !== typeof a) return null;
  a = Ja && a[Ja] || a["@@iterator"];
  return "function" === typeof a ? a : null;
}
var A = Object.assign, La;
function Ma(a) {
  if (void 0 === La) try {
    throw Error();
  } catch (c) {
    var b = c.stack.trim().match(/\n( *(at )?)/);
    La = b && b[1] || "";
  }
  return "\n" + La + a;
}
var Na = false;
function Oa(a, b) {
  if (!a || Na) return "";
  Na = true;
  var c = Error.prepareStackTrace;
  Error.prepareStackTrace = void 0;
  try {
    if (b) if (b = function() {
      throw Error();
    }, Object.defineProperty(b.prototype, "props", { set: function() {
      throw Error();
    } }), "object" === typeof Reflect && Reflect.construct) {
      try {
        Reflect.construct(b, []);
      } catch (l2) {
        var d = l2;
      }
      Reflect.construct(a, [], b);
    } else {
      try {
        b.call();
      } catch (l2) {
        d = l2;
      }
      a.call(b.prototype);
    }
    else {
      try {
        throw Error();
      } catch (l2) {
        d = l2;
      }
      a();
    }
  } catch (l2) {
    if (l2 && d && "string" === typeof l2.stack) {
      for (var e = l2.stack.split("\n"), f2 = d.stack.split("\n"), g = e.length - 1, h = f2.length - 1; 1 <= g && 0 <= h && e[g] !== f2[h]; ) h--;
      for (; 1 <= g && 0 <= h; g--, h--) if (e[g] !== f2[h]) {
        if (1 !== g || 1 !== h) {
          do
            if (g--, h--, 0 > h || e[g] !== f2[h]) {
              var k2 = "\n" + e[g].replace(" at new ", " at ");
              a.displayName && k2.includes("<anonymous>") && (k2 = k2.replace("<anonymous>", a.displayName));
              return k2;
            }
          while (1 <= g && 0 <= h);
        }
        break;
      }
    }
  } finally {
    Na = false, Error.prepareStackTrace = c;
  }
  return (a = a ? a.displayName || a.name : "") ? Ma(a) : "";
}
function Pa(a) {
  switch (a.tag) {
    case 5:
      return Ma(a.type);
    case 16:
      return Ma("Lazy");
    case 13:
      return Ma("Suspense");
    case 19:
      return Ma("SuspenseList");
    case 0:
    case 2:
    case 15:
      return a = Oa(a.type, false), a;
    case 11:
      return a = Oa(a.type.render, false), a;
    case 1:
      return a = Oa(a.type, true), a;
    default:
      return "";
  }
}
function Qa(a) {
  if (null == a) return null;
  if ("function" === typeof a) return a.displayName || a.name || null;
  if ("string" === typeof a) return a;
  switch (a) {
    case ya:
      return "Fragment";
    case wa:
      return "Portal";
    case Aa:
      return "Profiler";
    case za:
      return "StrictMode";
    case Ea:
      return "Suspense";
    case Fa:
      return "SuspenseList";
  }
  if ("object" === typeof a) switch (a.$$typeof) {
    case Ca:
      return (a.displayName || "Context") + ".Consumer";
    case Ba:
      return (a._context.displayName || "Context") + ".Provider";
    case Da:
      var b = a.render;
      a = a.displayName;
      a || (a = b.displayName || b.name || "", a = "" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
      return a;
    case Ga:
      return b = a.displayName || null, null !== b ? b : Qa(a.type) || "Memo";
    case Ha:
      b = a._payload;
      a = a._init;
      try {
        return Qa(a(b));
      } catch (c) {
      }
  }
  return null;
}
function Ra(a) {
  var b = a.type;
  switch (a.tag) {
    case 24:
      return "Cache";
    case 9:
      return (b.displayName || "Context") + ".Consumer";
    case 10:
      return (b._context.displayName || "Context") + ".Provider";
    case 18:
      return "DehydratedFragment";
    case 11:
      return a = b.render, a = a.displayName || a.name || "", b.displayName || ("" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
    case 7:
      return "Fragment";
    case 5:
      return b;
    case 4:
      return "Portal";
    case 3:
      return "Root";
    case 6:
      return "Text";
    case 16:
      return Qa(b);
    case 8:
      return b === za ? "StrictMode" : "Mode";
    case 22:
      return "Offscreen";
    case 12:
      return "Profiler";
    case 21:
      return "Scope";
    case 13:
      return "Suspense";
    case 19:
      return "SuspenseList";
    case 25:
      return "TracingMarker";
    case 1:
    case 0:
    case 17:
    case 2:
    case 14:
    case 15:
      if ("function" === typeof b) return b.displayName || b.name || null;
      if ("string" === typeof b) return b;
  }
  return null;
}
function Sa(a) {
  switch (typeof a) {
    case "boolean":
    case "number":
    case "string":
    case "undefined":
      return a;
    case "object":
      return a;
    default:
      return "";
  }
}
function Ta(a) {
  var b = a.type;
  return (a = a.nodeName) && "input" === a.toLowerCase() && ("checkbox" === b || "radio" === b);
}
function Ua(a) {
  var b = Ta(a) ? "checked" : "value", c = Object.getOwnPropertyDescriptor(a.constructor.prototype, b), d = "" + a[b];
  if (!a.hasOwnProperty(b) && "undefined" !== typeof c && "function" === typeof c.get && "function" === typeof c.set) {
    var e = c.get, f2 = c.set;
    Object.defineProperty(a, b, { configurable: true, get: function() {
      return e.call(this);
    }, set: function(a2) {
      d = "" + a2;
      f2.call(this, a2);
    } });
    Object.defineProperty(a, b, { enumerable: c.enumerable });
    return { getValue: function() {
      return d;
    }, setValue: function(a2) {
      d = "" + a2;
    }, stopTracking: function() {
      a._valueTracker = null;
      delete a[b];
    } };
  }
}
function Va(a) {
  a._valueTracker || (a._valueTracker = Ua(a));
}
function Wa(a) {
  if (!a) return false;
  var b = a._valueTracker;
  if (!b) return true;
  var c = b.getValue();
  var d = "";
  a && (d = Ta(a) ? a.checked ? "true" : "false" : a.value);
  a = d;
  return a !== c ? (b.setValue(a), true) : false;
}
function Xa(a) {
  a = a || ("undefined" !== typeof document ? document : void 0);
  if ("undefined" === typeof a) return null;
  try {
    return a.activeElement || a.body;
  } catch (b) {
    return a.body;
  }
}
function Ya(a, b) {
  var c = b.checked;
  return A({}, b, { defaultChecked: void 0, defaultValue: void 0, value: void 0, checked: null != c ? c : a._wrapperState.initialChecked });
}
function Za(a, b) {
  var c = null == b.defaultValue ? "" : b.defaultValue, d = null != b.checked ? b.checked : b.defaultChecked;
  c = Sa(null != b.value ? b.value : c);
  a._wrapperState = { initialChecked: d, initialValue: c, controlled: "checkbox" === b.type || "radio" === b.type ? null != b.checked : null != b.value };
}
function ab(a, b) {
  b = b.checked;
  null != b && ta(a, "checked", b, false);
}
function bb(a, b) {
  ab(a, b);
  var c = Sa(b.value), d = b.type;
  if (null != c) if ("number" === d) {
    if (0 === c && "" === a.value || a.value != c) a.value = "" + c;
  } else a.value !== "" + c && (a.value = "" + c);
  else if ("submit" === d || "reset" === d) {
    a.removeAttribute("value");
    return;
  }
  b.hasOwnProperty("value") ? cb(a, b.type, c) : b.hasOwnProperty("defaultValue") && cb(a, b.type, Sa(b.defaultValue));
  null == b.checked && null != b.defaultChecked && (a.defaultChecked = !!b.defaultChecked);
}
function db(a, b, c) {
  if (b.hasOwnProperty("value") || b.hasOwnProperty("defaultValue")) {
    var d = b.type;
    if (!("submit" !== d && "reset" !== d || void 0 !== b.value && null !== b.value)) return;
    b = "" + a._wrapperState.initialValue;
    c || b === a.value || (a.value = b);
    a.defaultValue = b;
  }
  c = a.name;
  "" !== c && (a.name = "");
  a.defaultChecked = !!a._wrapperState.initialChecked;
  "" !== c && (a.name = c);
}
function cb(a, b, c) {
  if ("number" !== b || Xa(a.ownerDocument) !== a) null == c ? a.defaultValue = "" + a._wrapperState.initialValue : a.defaultValue !== "" + c && (a.defaultValue = "" + c);
}
var eb = Array.isArray;
function fb(a, b, c, d) {
  a = a.options;
  if (b) {
    b = {};
    for (var e = 0; e < c.length; e++) b["$" + c[e]] = true;
    for (c = 0; c < a.length; c++) e = b.hasOwnProperty("$" + a[c].value), a[c].selected !== e && (a[c].selected = e), e && d && (a[c].defaultSelected = true);
  } else {
    c = "" + Sa(c);
    b = null;
    for (e = 0; e < a.length; e++) {
      if (a[e].value === c) {
        a[e].selected = true;
        d && (a[e].defaultSelected = true);
        return;
      }
      null !== b || a[e].disabled || (b = a[e]);
    }
    null !== b && (b.selected = true);
  }
}
function gb(a, b) {
  if (null != b.dangerouslySetInnerHTML) throw Error(p(91));
  return A({}, b, { value: void 0, defaultValue: void 0, children: "" + a._wrapperState.initialValue });
}
function hb(a, b) {
  var c = b.value;
  if (null == c) {
    c = b.children;
    b = b.defaultValue;
    if (null != c) {
      if (null != b) throw Error(p(92));
      if (eb(c)) {
        if (1 < c.length) throw Error(p(93));
        c = c[0];
      }
      b = c;
    }
    null == b && (b = "");
    c = b;
  }
  a._wrapperState = { initialValue: Sa(c) };
}
function ib(a, b) {
  var c = Sa(b.value), d = Sa(b.defaultValue);
  null != c && (c = "" + c, c !== a.value && (a.value = c), null == b.defaultValue && a.defaultValue !== c && (a.defaultValue = c));
  null != d && (a.defaultValue = "" + d);
}
function jb(a) {
  var b = a.textContent;
  b === a._wrapperState.initialValue && "" !== b && null !== b && (a.value = b);
}
function kb(a) {
  switch (a) {
    case "svg":
      return "http://www.w3.org/2000/svg";
    case "math":
      return "http://www.w3.org/1998/Math/MathML";
    default:
      return "http://www.w3.org/1999/xhtml";
  }
}
function lb(a, b) {
  return null == a || "http://www.w3.org/1999/xhtml" === a ? kb(b) : "http://www.w3.org/2000/svg" === a && "foreignObject" === b ? "http://www.w3.org/1999/xhtml" : a;
}
var mb, nb = function(a) {
  return "undefined" !== typeof MSApp && MSApp.execUnsafeLocalFunction ? function(b, c, d, e) {
    MSApp.execUnsafeLocalFunction(function() {
      return a(b, c, d, e);
    });
  } : a;
}(function(a, b) {
  if ("http://www.w3.org/2000/svg" !== a.namespaceURI || "innerHTML" in a) a.innerHTML = b;
  else {
    mb = mb || document.createElement("div");
    mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>";
    for (b = mb.firstChild; a.firstChild; ) a.removeChild(a.firstChild);
    for (; b.firstChild; ) a.appendChild(b.firstChild);
  }
});
function ob(a, b) {
  if (b) {
    var c = a.firstChild;
    if (c && c === a.lastChild && 3 === c.nodeType) {
      c.nodeValue = b;
      return;
    }
  }
  a.textContent = b;
}
var pb = {
  animationIterationCount: true,
  aspectRatio: true,
  borderImageOutset: true,
  borderImageSlice: true,
  borderImageWidth: true,
  boxFlex: true,
  boxFlexGroup: true,
  boxOrdinalGroup: true,
  columnCount: true,
  columns: true,
  flex: true,
  flexGrow: true,
  flexPositive: true,
  flexShrink: true,
  flexNegative: true,
  flexOrder: true,
  gridArea: true,
  gridRow: true,
  gridRowEnd: true,
  gridRowSpan: true,
  gridRowStart: true,
  gridColumn: true,
  gridColumnEnd: true,
  gridColumnSpan: true,
  gridColumnStart: true,
  fontWeight: true,
  lineClamp: true,
  lineHeight: true,
  opacity: true,
  order: true,
  orphans: true,
  tabSize: true,
  widows: true,
  zIndex: true,
  zoom: true,
  fillOpacity: true,
  floodOpacity: true,
  stopOpacity: true,
  strokeDasharray: true,
  strokeDashoffset: true,
  strokeMiterlimit: true,
  strokeOpacity: true,
  strokeWidth: true
}, qb = ["Webkit", "ms", "Moz", "O"];
Object.keys(pb).forEach(function(a) {
  qb.forEach(function(b) {
    b = b + a.charAt(0).toUpperCase() + a.substring(1);
    pb[b] = pb[a];
  });
});
function rb(a, b, c) {
  return null == b || "boolean" === typeof b || "" === b ? "" : c || "number" !== typeof b || 0 === b || pb.hasOwnProperty(a) && pb[a] ? ("" + b).trim() : b + "px";
}
function sb(a, b) {
  a = a.style;
  for (var c in b) if (b.hasOwnProperty(c)) {
    var d = 0 === c.indexOf("--"), e = rb(c, b[c], d);
    "float" === c && (c = "cssFloat");
    d ? a.setProperty(c, e) : a[c] = e;
  }
}
var tb = A({ menuitem: true }, { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, keygen: true, link: true, meta: true, param: true, source: true, track: true, wbr: true });
function ub(a, b) {
  if (b) {
    if (tb[a] && (null != b.children || null != b.dangerouslySetInnerHTML)) throw Error(p(137, a));
    if (null != b.dangerouslySetInnerHTML) {
      if (null != b.children) throw Error(p(60));
      if ("object" !== typeof b.dangerouslySetInnerHTML || !("__html" in b.dangerouslySetInnerHTML)) throw Error(p(61));
    }
    if (null != b.style && "object" !== typeof b.style) throw Error(p(62));
  }
}
function vb(a, b) {
  if (-1 === a.indexOf("-")) return "string" === typeof b.is;
  switch (a) {
    case "annotation-xml":
    case "color-profile":
    case "font-face":
    case "font-face-src":
    case "font-face-uri":
    case "font-face-format":
    case "font-face-name":
    case "missing-glyph":
      return false;
    default:
      return true;
  }
}
var wb = null;
function xb(a) {
  a = a.target || a.srcElement || window;
  a.correspondingUseElement && (a = a.correspondingUseElement);
  return 3 === a.nodeType ? a.parentNode : a;
}
var yb = null, zb = null, Ab = null;
function Bb(a) {
  if (a = Cb(a)) {
    if ("function" !== typeof yb) throw Error(p(280));
    var b = a.stateNode;
    b && (b = Db(b), yb(a.stateNode, a.type, b));
  }
}
function Eb(a) {
  zb ? Ab ? Ab.push(a) : Ab = [a] : zb = a;
}
function Fb() {
  if (zb) {
    var a = zb, b = Ab;
    Ab = zb = null;
    Bb(a);
    if (b) for (a = 0; a < b.length; a++) Bb(b[a]);
  }
}
function Gb(a, b) {
  return a(b);
}
function Hb() {
}
var Ib = false;
function Jb(a, b, c) {
  if (Ib) return a(b, c);
  Ib = true;
  try {
    return Gb(a, b, c);
  } finally {
    if (Ib = false, null !== zb || null !== Ab) Hb(), Fb();
  }
}
function Kb(a, b) {
  var c = a.stateNode;
  if (null === c) return null;
  var d = Db(c);
  if (null === d) return null;
  c = d[b];
  a: switch (b) {
    case "onClick":
    case "onClickCapture":
    case "onDoubleClick":
    case "onDoubleClickCapture":
    case "onMouseDown":
    case "onMouseDownCapture":
    case "onMouseMove":
    case "onMouseMoveCapture":
    case "onMouseUp":
    case "onMouseUpCapture":
    case "onMouseEnter":
      (d = !d.disabled) || (a = a.type, d = !("button" === a || "input" === a || "select" === a || "textarea" === a));
      a = !d;
      break a;
    default:
      a = false;
  }
  if (a) return null;
  if (c && "function" !== typeof c) throw Error(p(231, b, typeof c));
  return c;
}
var Lb = false;
if (ia) try {
  var Mb = {};
  Object.defineProperty(Mb, "passive", { get: function() {
    Lb = true;
  } });
  window.addEventListener("test", Mb, Mb);
  window.removeEventListener("test", Mb, Mb);
} catch (a) {
  Lb = false;
}
function Nb(a, b, c, d, e, f2, g, h, k2) {
  var l2 = Array.prototype.slice.call(arguments, 3);
  try {
    b.apply(c, l2);
  } catch (m2) {
    this.onError(m2);
  }
}
var Ob = false, Pb = null, Qb = false, Rb = null, Sb = { onError: function(a) {
  Ob = true;
  Pb = a;
} };
function Tb(a, b, c, d, e, f2, g, h, k2) {
  Ob = false;
  Pb = null;
  Nb.apply(Sb, arguments);
}
function Ub(a, b, c, d, e, f2, g, h, k2) {
  Tb.apply(this, arguments);
  if (Ob) {
    if (Ob) {
      var l2 = Pb;
      Ob = false;
      Pb = null;
    } else throw Error(p(198));
    Qb || (Qb = true, Rb = l2);
  }
}
function Vb(a) {
  var b = a, c = a;
  if (a.alternate) for (; b.return; ) b = b.return;
  else {
    a = b;
    do
      b = a, 0 !== (b.flags & 4098) && (c = b.return), a = b.return;
    while (a);
  }
  return 3 === b.tag ? c : null;
}
function Wb(a) {
  if (13 === a.tag) {
    var b = a.memoizedState;
    null === b && (a = a.alternate, null !== a && (b = a.memoizedState));
    if (null !== b) return b.dehydrated;
  }
  return null;
}
function Xb(a) {
  if (Vb(a) !== a) throw Error(p(188));
}
function Yb(a) {
  var b = a.alternate;
  if (!b) {
    b = Vb(a);
    if (null === b) throw Error(p(188));
    return b !== a ? null : a;
  }
  for (var c = a, d = b; ; ) {
    var e = c.return;
    if (null === e) break;
    var f2 = e.alternate;
    if (null === f2) {
      d = e.return;
      if (null !== d) {
        c = d;
        continue;
      }
      break;
    }
    if (e.child === f2.child) {
      for (f2 = e.child; f2; ) {
        if (f2 === c) return Xb(e), a;
        if (f2 === d) return Xb(e), b;
        f2 = f2.sibling;
      }
      throw Error(p(188));
    }
    if (c.return !== d.return) c = e, d = f2;
    else {
      for (var g = false, h = e.child; h; ) {
        if (h === c) {
          g = true;
          c = e;
          d = f2;
          break;
        }
        if (h === d) {
          g = true;
          d = e;
          c = f2;
          break;
        }
        h = h.sibling;
      }
      if (!g) {
        for (h = f2.child; h; ) {
          if (h === c) {
            g = true;
            c = f2;
            d = e;
            break;
          }
          if (h === d) {
            g = true;
            d = f2;
            c = e;
            break;
          }
          h = h.sibling;
        }
        if (!g) throw Error(p(189));
      }
    }
    if (c.alternate !== d) throw Error(p(190));
  }
  if (3 !== c.tag) throw Error(p(188));
  return c.stateNode.current === c ? a : b;
}
function Zb(a) {
  a = Yb(a);
  return null !== a ? $b(a) : null;
}
function $b(a) {
  if (5 === a.tag || 6 === a.tag) return a;
  for (a = a.child; null !== a; ) {
    var b = $b(a);
    if (null !== b) return b;
    a = a.sibling;
  }
  return null;
}
var ac = ca.unstable_scheduleCallback, bc = ca.unstable_cancelCallback, cc = ca.unstable_shouldYield, dc = ca.unstable_requestPaint, B = ca.unstable_now, ec = ca.unstable_getCurrentPriorityLevel, fc = ca.unstable_ImmediatePriority, gc = ca.unstable_UserBlockingPriority, hc = ca.unstable_NormalPriority, ic = ca.unstable_LowPriority, jc = ca.unstable_IdlePriority, kc = null, lc = null;
function mc(a) {
  if (lc && "function" === typeof lc.onCommitFiberRoot) try {
    lc.onCommitFiberRoot(kc, a, void 0, 128 === (a.current.flags & 128));
  } catch (b) {
  }
}
var oc = Math.clz32 ? Math.clz32 : nc, pc = Math.log, qc = Math.LN2;
function nc(a) {
  a >>>= 0;
  return 0 === a ? 32 : 31 - (pc(a) / qc | 0) | 0;
}
var rc = 64, sc = 4194304;
function tc(a) {
  switch (a & -a) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 4:
      return 4;
    case 8:
      return 8;
    case 16:
      return 16;
    case 32:
      return 32;
    case 64:
    case 128:
    case 256:
    case 512:
    case 1024:
    case 2048:
    case 4096:
    case 8192:
    case 16384:
    case 32768:
    case 65536:
    case 131072:
    case 262144:
    case 524288:
    case 1048576:
    case 2097152:
      return a & 4194240;
    case 4194304:
    case 8388608:
    case 16777216:
    case 33554432:
    case 67108864:
      return a & 130023424;
    case 134217728:
      return 134217728;
    case 268435456:
      return 268435456;
    case 536870912:
      return 536870912;
    case 1073741824:
      return 1073741824;
    default:
      return a;
  }
}
function uc(a, b) {
  var c = a.pendingLanes;
  if (0 === c) return 0;
  var d = 0, e = a.suspendedLanes, f2 = a.pingedLanes, g = c & 268435455;
  if (0 !== g) {
    var h = g & ~e;
    0 !== h ? d = tc(h) : (f2 &= g, 0 !== f2 && (d = tc(f2)));
  } else g = c & ~e, 0 !== g ? d = tc(g) : 0 !== f2 && (d = tc(f2));
  if (0 === d) return 0;
  if (0 !== b && b !== d && 0 === (b & e) && (e = d & -d, f2 = b & -b, e >= f2 || 16 === e && 0 !== (f2 & 4194240))) return b;
  0 !== (d & 4) && (d |= c & 16);
  b = a.entangledLanes;
  if (0 !== b) for (a = a.entanglements, b &= d; 0 < b; ) c = 31 - oc(b), e = 1 << c, d |= a[c], b &= ~e;
  return d;
}
function vc(a, b) {
  switch (a) {
    case 1:
    case 2:
    case 4:
      return b + 250;
    case 8:
    case 16:
    case 32:
    case 64:
    case 128:
    case 256:
    case 512:
    case 1024:
    case 2048:
    case 4096:
    case 8192:
    case 16384:
    case 32768:
    case 65536:
    case 131072:
    case 262144:
    case 524288:
    case 1048576:
    case 2097152:
      return b + 5e3;
    case 4194304:
    case 8388608:
    case 16777216:
    case 33554432:
    case 67108864:
      return -1;
    case 134217728:
    case 268435456:
    case 536870912:
    case 1073741824:
      return -1;
    default:
      return -1;
  }
}
function wc(a, b) {
  for (var c = a.suspendedLanes, d = a.pingedLanes, e = a.expirationTimes, f2 = a.pendingLanes; 0 < f2; ) {
    var g = 31 - oc(f2), h = 1 << g, k2 = e[g];
    if (-1 === k2) {
      if (0 === (h & c) || 0 !== (h & d)) e[g] = vc(h, b);
    } else k2 <= b && (a.expiredLanes |= h);
    f2 &= ~h;
  }
}
function xc(a) {
  a = a.pendingLanes & -1073741825;
  return 0 !== a ? a : a & 1073741824 ? 1073741824 : 0;
}
function yc() {
  var a = rc;
  rc <<= 1;
  0 === (rc & 4194240) && (rc = 64);
  return a;
}
function zc(a) {
  for (var b = [], c = 0; 31 > c; c++) b.push(a);
  return b;
}
function Ac(a, b, c) {
  a.pendingLanes |= b;
  536870912 !== b && (a.suspendedLanes = 0, a.pingedLanes = 0);
  a = a.eventTimes;
  b = 31 - oc(b);
  a[b] = c;
}
function Bc(a, b) {
  var c = a.pendingLanes & ~b;
  a.pendingLanes = b;
  a.suspendedLanes = 0;
  a.pingedLanes = 0;
  a.expiredLanes &= b;
  a.mutableReadLanes &= b;
  a.entangledLanes &= b;
  b = a.entanglements;
  var d = a.eventTimes;
  for (a = a.expirationTimes; 0 < c; ) {
    var e = 31 - oc(c), f2 = 1 << e;
    b[e] = 0;
    d[e] = -1;
    a[e] = -1;
    c &= ~f2;
  }
}
function Cc(a, b) {
  var c = a.entangledLanes |= b;
  for (a = a.entanglements; c; ) {
    var d = 31 - oc(c), e = 1 << d;
    e & b | a[d] & b && (a[d] |= b);
    c &= ~e;
  }
}
var C = 0;
function Dc(a) {
  a &= -a;
  return 1 < a ? 4 < a ? 0 !== (a & 268435455) ? 16 : 536870912 : 4 : 1;
}
var Ec, Fc, Gc, Hc, Ic, Jc = false, Kc = [], Lc = null, Mc = null, Nc = null, Oc = /* @__PURE__ */ new Map(), Pc = /* @__PURE__ */ new Map(), Qc = [], Rc = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");
function Sc(a, b) {
  switch (a) {
    case "focusin":
    case "focusout":
      Lc = null;
      break;
    case "dragenter":
    case "dragleave":
      Mc = null;
      break;
    case "mouseover":
    case "mouseout":
      Nc = null;
      break;
    case "pointerover":
    case "pointerout":
      Oc.delete(b.pointerId);
      break;
    case "gotpointercapture":
    case "lostpointercapture":
      Pc.delete(b.pointerId);
  }
}
function Tc(a, b, c, d, e, f2) {
  if (null === a || a.nativeEvent !== f2) return a = { blockedOn: b, domEventName: c, eventSystemFlags: d, nativeEvent: f2, targetContainers: [e] }, null !== b && (b = Cb(b), null !== b && Fc(b)), a;
  a.eventSystemFlags |= d;
  b = a.targetContainers;
  null !== e && -1 === b.indexOf(e) && b.push(e);
  return a;
}
function Uc(a, b, c, d, e) {
  switch (b) {
    case "focusin":
      return Lc = Tc(Lc, a, b, c, d, e), true;
    case "dragenter":
      return Mc = Tc(Mc, a, b, c, d, e), true;
    case "mouseover":
      return Nc = Tc(Nc, a, b, c, d, e), true;
    case "pointerover":
      var f2 = e.pointerId;
      Oc.set(f2, Tc(Oc.get(f2) || null, a, b, c, d, e));
      return true;
    case "gotpointercapture":
      return f2 = e.pointerId, Pc.set(f2, Tc(Pc.get(f2) || null, a, b, c, d, e)), true;
  }
  return false;
}
function Vc(a) {
  var b = Wc(a.target);
  if (null !== b) {
    var c = Vb(b);
    if (null !== c) {
      if (b = c.tag, 13 === b) {
        if (b = Wb(c), null !== b) {
          a.blockedOn = b;
          Ic(a.priority, function() {
            Gc(c);
          });
          return;
        }
      } else if (3 === b && c.stateNode.current.memoizedState.isDehydrated) {
        a.blockedOn = 3 === c.tag ? c.stateNode.containerInfo : null;
        return;
      }
    }
  }
  a.blockedOn = null;
}
function Xc(a) {
  if (null !== a.blockedOn) return false;
  for (var b = a.targetContainers; 0 < b.length; ) {
    var c = Yc(a.domEventName, a.eventSystemFlags, b[0], a.nativeEvent);
    if (null === c) {
      c = a.nativeEvent;
      var d = new c.constructor(c.type, c);
      wb = d;
      c.target.dispatchEvent(d);
      wb = null;
    } else return b = Cb(c), null !== b && Fc(b), a.blockedOn = c, false;
    b.shift();
  }
  return true;
}
function Zc(a, b, c) {
  Xc(a) && c.delete(b);
}
function $c() {
  Jc = false;
  null !== Lc && Xc(Lc) && (Lc = null);
  null !== Mc && Xc(Mc) && (Mc = null);
  null !== Nc && Xc(Nc) && (Nc = null);
  Oc.forEach(Zc);
  Pc.forEach(Zc);
}
function ad(a, b) {
  a.blockedOn === b && (a.blockedOn = null, Jc || (Jc = true, ca.unstable_scheduleCallback(ca.unstable_NormalPriority, $c)));
}
function bd(a) {
  function b(b2) {
    return ad(b2, a);
  }
  if (0 < Kc.length) {
    ad(Kc[0], a);
    for (var c = 1; c < Kc.length; c++) {
      var d = Kc[c];
      d.blockedOn === a && (d.blockedOn = null);
    }
  }
  null !== Lc && ad(Lc, a);
  null !== Mc && ad(Mc, a);
  null !== Nc && ad(Nc, a);
  Oc.forEach(b);
  Pc.forEach(b);
  for (c = 0; c < Qc.length; c++) d = Qc[c], d.blockedOn === a && (d.blockedOn = null);
  for (; 0 < Qc.length && (c = Qc[0], null === c.blockedOn); ) Vc(c), null === c.blockedOn && Qc.shift();
}
var cd = ua.ReactCurrentBatchConfig, dd = true;
function ed(a, b, c, d) {
  var e = C, f2 = cd.transition;
  cd.transition = null;
  try {
    C = 1, fd(a, b, c, d);
  } finally {
    C = e, cd.transition = f2;
  }
}
function gd(a, b, c, d) {
  var e = C, f2 = cd.transition;
  cd.transition = null;
  try {
    C = 4, fd(a, b, c, d);
  } finally {
    C = e, cd.transition = f2;
  }
}
function fd(a, b, c, d) {
  if (dd) {
    var e = Yc(a, b, c, d);
    if (null === e) hd(a, b, d, id, c), Sc(a, d);
    else if (Uc(e, a, b, c, d)) d.stopPropagation();
    else if (Sc(a, d), b & 4 && -1 < Rc.indexOf(a)) {
      for (; null !== e; ) {
        var f2 = Cb(e);
        null !== f2 && Ec(f2);
        f2 = Yc(a, b, c, d);
        null === f2 && hd(a, b, d, id, c);
        if (f2 === e) break;
        e = f2;
      }
      null !== e && d.stopPropagation();
    } else hd(a, b, d, null, c);
  }
}
var id = null;
function Yc(a, b, c, d) {
  id = null;
  a = xb(d);
  a = Wc(a);
  if (null !== a) if (b = Vb(a), null === b) a = null;
  else if (c = b.tag, 13 === c) {
    a = Wb(b);
    if (null !== a) return a;
    a = null;
  } else if (3 === c) {
    if (b.stateNode.current.memoizedState.isDehydrated) return 3 === b.tag ? b.stateNode.containerInfo : null;
    a = null;
  } else b !== a && (a = null);
  id = a;
  return null;
}
function jd(a) {
  switch (a) {
    case "cancel":
    case "click":
    case "close":
    case "contextmenu":
    case "copy":
    case "cut":
    case "auxclick":
    case "dblclick":
    case "dragend":
    case "dragstart":
    case "drop":
    case "focusin":
    case "focusout":
    case "input":
    case "invalid":
    case "keydown":
    case "keypress":
    case "keyup":
    case "mousedown":
    case "mouseup":
    case "paste":
    case "pause":
    case "play":
    case "pointercancel":
    case "pointerdown":
    case "pointerup":
    case "ratechange":
    case "reset":
    case "resize":
    case "seeked":
    case "submit":
    case "touchcancel":
    case "touchend":
    case "touchstart":
    case "volumechange":
    case "change":
    case "selectionchange":
    case "textInput":
    case "compositionstart":
    case "compositionend":
    case "compositionupdate":
    case "beforeblur":
    case "afterblur":
    case "beforeinput":
    case "blur":
    case "fullscreenchange":
    case "focus":
    case "hashchange":
    case "popstate":
    case "select":
    case "selectstart":
      return 1;
    case "drag":
    case "dragenter":
    case "dragexit":
    case "dragleave":
    case "dragover":
    case "mousemove":
    case "mouseout":
    case "mouseover":
    case "pointermove":
    case "pointerout":
    case "pointerover":
    case "scroll":
    case "toggle":
    case "touchmove":
    case "wheel":
    case "mouseenter":
    case "mouseleave":
    case "pointerenter":
    case "pointerleave":
      return 4;
    case "message":
      switch (ec()) {
        case fc:
          return 1;
        case gc:
          return 4;
        case hc:
        case ic:
          return 16;
        case jc:
          return 536870912;
        default:
          return 16;
      }
    default:
      return 16;
  }
}
var kd = null, ld = null, md = null;
function nd() {
  if (md) return md;
  var a, b = ld, c = b.length, d, e = "value" in kd ? kd.value : kd.textContent, f2 = e.length;
  for (a = 0; a < c && b[a] === e[a]; a++) ;
  var g = c - a;
  for (d = 1; d <= g && b[c - d] === e[f2 - d]; d++) ;
  return md = e.slice(a, 1 < d ? 1 - d : void 0);
}
function od(a) {
  var b = a.keyCode;
  "charCode" in a ? (a = a.charCode, 0 === a && 13 === b && (a = 13)) : a = b;
  10 === a && (a = 13);
  return 32 <= a || 13 === a ? a : 0;
}
function pd() {
  return true;
}
function qd() {
  return false;
}
function rd(a) {
  function b(b2, d, e, f2, g) {
    this._reactName = b2;
    this._targetInst = e;
    this.type = d;
    this.nativeEvent = f2;
    this.target = g;
    this.currentTarget = null;
    for (var c in a) a.hasOwnProperty(c) && (b2 = a[c], this[c] = b2 ? b2(f2) : f2[c]);
    this.isDefaultPrevented = (null != f2.defaultPrevented ? f2.defaultPrevented : false === f2.returnValue) ? pd : qd;
    this.isPropagationStopped = qd;
    return this;
  }
  A(b.prototype, { preventDefault: function() {
    this.defaultPrevented = true;
    var a2 = this.nativeEvent;
    a2 && (a2.preventDefault ? a2.preventDefault() : "unknown" !== typeof a2.returnValue && (a2.returnValue = false), this.isDefaultPrevented = pd);
  }, stopPropagation: function() {
    var a2 = this.nativeEvent;
    a2 && (a2.stopPropagation ? a2.stopPropagation() : "unknown" !== typeof a2.cancelBubble && (a2.cancelBubble = true), this.isPropagationStopped = pd);
  }, persist: function() {
  }, isPersistent: pd });
  return b;
}
var sd = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(a) {
  return a.timeStamp || Date.now();
}, defaultPrevented: 0, isTrusted: 0 }, td = rd(sd), ud = A({}, sd, { view: 0, detail: 0 }), vd = rd(ud), wd, xd, yd, Ad = A({}, ud, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: zd, button: 0, buttons: 0, relatedTarget: function(a) {
  return void 0 === a.relatedTarget ? a.fromElement === a.srcElement ? a.toElement : a.fromElement : a.relatedTarget;
}, movementX: function(a) {
  if ("movementX" in a) return a.movementX;
  a !== yd && (yd && "mousemove" === a.type ? (wd = a.screenX - yd.screenX, xd = a.screenY - yd.screenY) : xd = wd = 0, yd = a);
  return wd;
}, movementY: function(a) {
  return "movementY" in a ? a.movementY : xd;
} }), Bd = rd(Ad), Cd = A({}, Ad, { dataTransfer: 0 }), Dd = rd(Cd), Ed = A({}, ud, { relatedTarget: 0 }), Fd = rd(Ed), Gd = A({}, sd, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }), Hd = rd(Gd), Id = A({}, sd, { clipboardData: function(a) {
  return "clipboardData" in a ? a.clipboardData : window.clipboardData;
} }), Jd = rd(Id), Kd = A({}, sd, { data: 0 }), Ld = rd(Kd), Md = {
  Esc: "Escape",
  Spacebar: " ",
  Left: "ArrowLeft",
  Up: "ArrowUp",
  Right: "ArrowRight",
  Down: "ArrowDown",
  Del: "Delete",
  Win: "OS",
  Menu: "ContextMenu",
  Apps: "ContextMenu",
  Scroll: "ScrollLock",
  MozPrintableKey: "Unidentified"
}, Nd = {
  8: "Backspace",
  9: "Tab",
  12: "Clear",
  13: "Enter",
  16: "Shift",
  17: "Control",
  18: "Alt",
  19: "Pause",
  20: "CapsLock",
  27: "Escape",
  32: " ",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  45: "Insert",
  46: "Delete",
  112: "F1",
  113: "F2",
  114: "F3",
  115: "F4",
  116: "F5",
  117: "F6",
  118: "F7",
  119: "F8",
  120: "F9",
  121: "F10",
  122: "F11",
  123: "F12",
  144: "NumLock",
  145: "ScrollLock",
  224: "Meta"
}, Od = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
function Pd(a) {
  var b = this.nativeEvent;
  return b.getModifierState ? b.getModifierState(a) : (a = Od[a]) ? !!b[a] : false;
}
function zd() {
  return Pd;
}
var Qd = A({}, ud, { key: function(a) {
  if (a.key) {
    var b = Md[a.key] || a.key;
    if ("Unidentified" !== b) return b;
  }
  return "keypress" === a.type ? (a = od(a), 13 === a ? "Enter" : String.fromCharCode(a)) : "keydown" === a.type || "keyup" === a.type ? Nd[a.keyCode] || "Unidentified" : "";
}, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: zd, charCode: function(a) {
  return "keypress" === a.type ? od(a) : 0;
}, keyCode: function(a) {
  return "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
}, which: function(a) {
  return "keypress" === a.type ? od(a) : "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
} }), Rd = rd(Qd), Sd = A({}, Ad, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 }), Td = rd(Sd), Ud = A({}, ud, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: zd }), Vd = rd(Ud), Wd = A({}, sd, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }), Xd = rd(Wd), Yd = A({}, Ad, {
  deltaX: function(a) {
    return "deltaX" in a ? a.deltaX : "wheelDeltaX" in a ? -a.wheelDeltaX : 0;
  },
  deltaY: function(a) {
    return "deltaY" in a ? a.deltaY : "wheelDeltaY" in a ? -a.wheelDeltaY : "wheelDelta" in a ? -a.wheelDelta : 0;
  },
  deltaZ: 0,
  deltaMode: 0
}), Zd = rd(Yd), $d = [9, 13, 27, 32], ae = ia && "CompositionEvent" in window, be = null;
ia && "documentMode" in document && (be = document.documentMode);
var ce = ia && "TextEvent" in window && !be, de = ia && (!ae || be && 8 < be && 11 >= be), ee = String.fromCharCode(32), fe = false;
function ge(a, b) {
  switch (a) {
    case "keyup":
      return -1 !== $d.indexOf(b.keyCode);
    case "keydown":
      return 229 !== b.keyCode;
    case "keypress":
    case "mousedown":
    case "focusout":
      return true;
    default:
      return false;
  }
}
function he(a) {
  a = a.detail;
  return "object" === typeof a && "data" in a ? a.data : null;
}
var ie = false;
function je(a, b) {
  switch (a) {
    case "compositionend":
      return he(b);
    case "keypress":
      if (32 !== b.which) return null;
      fe = true;
      return ee;
    case "textInput":
      return a = b.data, a === ee && fe ? null : a;
    default:
      return null;
  }
}
function ke(a, b) {
  if (ie) return "compositionend" === a || !ae && ge(a, b) ? (a = nd(), md = ld = kd = null, ie = false, a) : null;
  switch (a) {
    case "paste":
      return null;
    case "keypress":
      if (!(b.ctrlKey || b.altKey || b.metaKey) || b.ctrlKey && b.altKey) {
        if (b.char && 1 < b.char.length) return b.char;
        if (b.which) return String.fromCharCode(b.which);
      }
      return null;
    case "compositionend":
      return de && "ko" !== b.locale ? null : b.data;
    default:
      return null;
  }
}
var le = { color: true, date: true, datetime: true, "datetime-local": true, email: true, month: true, number: true, password: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true };
function me(a) {
  var b = a && a.nodeName && a.nodeName.toLowerCase();
  return "input" === b ? !!le[a.type] : "textarea" === b ? true : false;
}
function ne(a, b, c, d) {
  Eb(d);
  b = oe(b, "onChange");
  0 < b.length && (c = new td("onChange", "change", null, c, d), a.push({ event: c, listeners: b }));
}
var pe = null, qe = null;
function re(a) {
  se(a, 0);
}
function te(a) {
  var b = ue(a);
  if (Wa(b)) return a;
}
function ve(a, b) {
  if ("change" === a) return b;
}
var we = false;
if (ia) {
  var xe;
  if (ia) {
    var ye = "oninput" in document;
    if (!ye) {
      var ze = document.createElement("div");
      ze.setAttribute("oninput", "return;");
      ye = "function" === typeof ze.oninput;
    }
    xe = ye;
  } else xe = false;
  we = xe && (!document.documentMode || 9 < document.documentMode);
}
function Ae() {
  pe && (pe.detachEvent("onpropertychange", Be), qe = pe = null);
}
function Be(a) {
  if ("value" === a.propertyName && te(qe)) {
    var b = [];
    ne(b, qe, a, xb(a));
    Jb(re, b);
  }
}
function Ce(a, b, c) {
  "focusin" === a ? (Ae(), pe = b, qe = c, pe.attachEvent("onpropertychange", Be)) : "focusout" === a && Ae();
}
function De(a) {
  if ("selectionchange" === a || "keyup" === a || "keydown" === a) return te(qe);
}
function Ee(a, b) {
  if ("click" === a) return te(b);
}
function Fe(a, b) {
  if ("input" === a || "change" === a) return te(b);
}
function Ge(a, b) {
  return a === b && (0 !== a || 1 / a === 1 / b) || a !== a && b !== b;
}
var He = "function" === typeof Object.is ? Object.is : Ge;
function Ie(a, b) {
  if (He(a, b)) return true;
  if ("object" !== typeof a || null === a || "object" !== typeof b || null === b) return false;
  var c = Object.keys(a), d = Object.keys(b);
  if (c.length !== d.length) return false;
  for (d = 0; d < c.length; d++) {
    var e = c[d];
    if (!ja.call(b, e) || !He(a[e], b[e])) return false;
  }
  return true;
}
function Je(a) {
  for (; a && a.firstChild; ) a = a.firstChild;
  return a;
}
function Ke(a, b) {
  var c = Je(a);
  a = 0;
  for (var d; c; ) {
    if (3 === c.nodeType) {
      d = a + c.textContent.length;
      if (a <= b && d >= b) return { node: c, offset: b - a };
      a = d;
    }
    a: {
      for (; c; ) {
        if (c.nextSibling) {
          c = c.nextSibling;
          break a;
        }
        c = c.parentNode;
      }
      c = void 0;
    }
    c = Je(c);
  }
}
function Le(a, b) {
  return a && b ? a === b ? true : a && 3 === a.nodeType ? false : b && 3 === b.nodeType ? Le(a, b.parentNode) : "contains" in a ? a.contains(b) : a.compareDocumentPosition ? !!(a.compareDocumentPosition(b) & 16) : false : false;
}
function Me() {
  for (var a = window, b = Xa(); b instanceof a.HTMLIFrameElement; ) {
    try {
      var c = "string" === typeof b.contentWindow.location.href;
    } catch (d) {
      c = false;
    }
    if (c) a = b.contentWindow;
    else break;
    b = Xa(a.document);
  }
  return b;
}
function Ne(a) {
  var b = a && a.nodeName && a.nodeName.toLowerCase();
  return b && ("input" === b && ("text" === a.type || "search" === a.type || "tel" === a.type || "url" === a.type || "password" === a.type) || "textarea" === b || "true" === a.contentEditable);
}
function Oe(a) {
  var b = Me(), c = a.focusedElem, d = a.selectionRange;
  if (b !== c && c && c.ownerDocument && Le(c.ownerDocument.documentElement, c)) {
    if (null !== d && Ne(c)) {
      if (b = d.start, a = d.end, void 0 === a && (a = b), "selectionStart" in c) c.selectionStart = b, c.selectionEnd = Math.min(a, c.value.length);
      else if (a = (b = c.ownerDocument || document) && b.defaultView || window, a.getSelection) {
        a = a.getSelection();
        var e = c.textContent.length, f2 = Math.min(d.start, e);
        d = void 0 === d.end ? f2 : Math.min(d.end, e);
        !a.extend && f2 > d && (e = d, d = f2, f2 = e);
        e = Ke(c, f2);
        var g = Ke(
          c,
          d
        );
        e && g && (1 !== a.rangeCount || a.anchorNode !== e.node || a.anchorOffset !== e.offset || a.focusNode !== g.node || a.focusOffset !== g.offset) && (b = b.createRange(), b.setStart(e.node, e.offset), a.removeAllRanges(), f2 > d ? (a.addRange(b), a.extend(g.node, g.offset)) : (b.setEnd(g.node, g.offset), a.addRange(b)));
      }
    }
    b = [];
    for (a = c; a = a.parentNode; ) 1 === a.nodeType && b.push({ element: a, left: a.scrollLeft, top: a.scrollTop });
    "function" === typeof c.focus && c.focus();
    for (c = 0; c < b.length; c++) a = b[c], a.element.scrollLeft = a.left, a.element.scrollTop = a.top;
  }
}
var Pe = ia && "documentMode" in document && 11 >= document.documentMode, Qe = null, Re = null, Se = null, Te = false;
function Ue(a, b, c) {
  var d = c.window === c ? c.document : 9 === c.nodeType ? c : c.ownerDocument;
  Te || null == Qe || Qe !== Xa(d) || (d = Qe, "selectionStart" in d && Ne(d) ? d = { start: d.selectionStart, end: d.selectionEnd } : (d = (d.ownerDocument && d.ownerDocument.defaultView || window).getSelection(), d = { anchorNode: d.anchorNode, anchorOffset: d.anchorOffset, focusNode: d.focusNode, focusOffset: d.focusOffset }), Se && Ie(Se, d) || (Se = d, d = oe(Re, "onSelect"), 0 < d.length && (b = new td("onSelect", "select", null, b, c), a.push({ event: b, listeners: d }), b.target = Qe)));
}
function Ve(a, b) {
  var c = {};
  c[a.toLowerCase()] = b.toLowerCase();
  c["Webkit" + a] = "webkit" + b;
  c["Moz" + a] = "moz" + b;
  return c;
}
var We = { animationend: Ve("Animation", "AnimationEnd"), animationiteration: Ve("Animation", "AnimationIteration"), animationstart: Ve("Animation", "AnimationStart"), transitionend: Ve("Transition", "TransitionEnd") }, Xe = {}, Ye = {};
ia && (Ye = document.createElement("div").style, "AnimationEvent" in window || (delete We.animationend.animation, delete We.animationiteration.animation, delete We.animationstart.animation), "TransitionEvent" in window || delete We.transitionend.transition);
function Ze(a) {
  if (Xe[a]) return Xe[a];
  if (!We[a]) return a;
  var b = We[a], c;
  for (c in b) if (b.hasOwnProperty(c) && c in Ye) return Xe[a] = b[c];
  return a;
}
var $e = Ze("animationend"), af = Ze("animationiteration"), bf = Ze("animationstart"), cf = Ze("transitionend"), df = /* @__PURE__ */ new Map(), ef = "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
function ff(a, b) {
  df.set(a, b);
  fa(b, [a]);
}
for (var gf = 0; gf < ef.length; gf++) {
  var hf = ef[gf], jf = hf.toLowerCase(), kf = hf[0].toUpperCase() + hf.slice(1);
  ff(jf, "on" + kf);
}
ff($e, "onAnimationEnd");
ff(af, "onAnimationIteration");
ff(bf, "onAnimationStart");
ff("dblclick", "onDoubleClick");
ff("focusin", "onFocus");
ff("focusout", "onBlur");
ff(cf, "onTransitionEnd");
ha("onMouseEnter", ["mouseout", "mouseover"]);
ha("onMouseLeave", ["mouseout", "mouseover"]);
ha("onPointerEnter", ["pointerout", "pointerover"]);
ha("onPointerLeave", ["pointerout", "pointerover"]);
fa("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
fa("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
fa("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
fa("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
fa("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
fa("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
var lf = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), mf = new Set("cancel close invalid load scroll toggle".split(" ").concat(lf));
function nf(a, b, c) {
  var d = a.type || "unknown-event";
  a.currentTarget = c;
  Ub(d, b, void 0, a);
  a.currentTarget = null;
}
function se(a, b) {
  b = 0 !== (b & 4);
  for (var c = 0; c < a.length; c++) {
    var d = a[c], e = d.event;
    d = d.listeners;
    a: {
      var f2 = void 0;
      if (b) for (var g = d.length - 1; 0 <= g; g--) {
        var h = d[g], k2 = h.instance, l2 = h.currentTarget;
        h = h.listener;
        if (k2 !== f2 && e.isPropagationStopped()) break a;
        nf(e, h, l2);
        f2 = k2;
      }
      else for (g = 0; g < d.length; g++) {
        h = d[g];
        k2 = h.instance;
        l2 = h.currentTarget;
        h = h.listener;
        if (k2 !== f2 && e.isPropagationStopped()) break a;
        nf(e, h, l2);
        f2 = k2;
      }
    }
  }
  if (Qb) throw a = Rb, Qb = false, Rb = null, a;
}
function D(a, b) {
  var c = b[of];
  void 0 === c && (c = b[of] = /* @__PURE__ */ new Set());
  var d = a + "__bubble";
  c.has(d) || (pf(b, a, 2, false), c.add(d));
}
function qf(a, b, c) {
  var d = 0;
  b && (d |= 4);
  pf(c, a, d, b);
}
var rf = "_reactListening" + Math.random().toString(36).slice(2);
function sf(a) {
  if (!a[rf]) {
    a[rf] = true;
    da.forEach(function(b2) {
      "selectionchange" !== b2 && (mf.has(b2) || qf(b2, false, a), qf(b2, true, a));
    });
    var b = 9 === a.nodeType ? a : a.ownerDocument;
    null === b || b[rf] || (b[rf] = true, qf("selectionchange", false, b));
  }
}
function pf(a, b, c, d) {
  switch (jd(b)) {
    case 1:
      var e = ed;
      break;
    case 4:
      e = gd;
      break;
    default:
      e = fd;
  }
  c = e.bind(null, b, c, a);
  e = void 0;
  !Lb || "touchstart" !== b && "touchmove" !== b && "wheel" !== b || (e = true);
  d ? void 0 !== e ? a.addEventListener(b, c, { capture: true, passive: e }) : a.addEventListener(b, c, true) : void 0 !== e ? a.addEventListener(b, c, { passive: e }) : a.addEventListener(b, c, false);
}
function hd(a, b, c, d, e) {
  var f2 = d;
  if (0 === (b & 1) && 0 === (b & 2) && null !== d) a: for (; ; ) {
    if (null === d) return;
    var g = d.tag;
    if (3 === g || 4 === g) {
      var h = d.stateNode.containerInfo;
      if (h === e || 8 === h.nodeType && h.parentNode === e) break;
      if (4 === g) for (g = d.return; null !== g; ) {
        var k2 = g.tag;
        if (3 === k2 || 4 === k2) {
          if (k2 = g.stateNode.containerInfo, k2 === e || 8 === k2.nodeType && k2.parentNode === e) return;
        }
        g = g.return;
      }
      for (; null !== h; ) {
        g = Wc(h);
        if (null === g) return;
        k2 = g.tag;
        if (5 === k2 || 6 === k2) {
          d = f2 = g;
          continue a;
        }
        h = h.parentNode;
      }
    }
    d = d.return;
  }
  Jb(function() {
    var d2 = f2, e2 = xb(c), g2 = [];
    a: {
      var h2 = df.get(a);
      if (void 0 !== h2) {
        var k3 = td, n2 = a;
        switch (a) {
          case "keypress":
            if (0 === od(c)) break a;
          case "keydown":
          case "keyup":
            k3 = Rd;
            break;
          case "focusin":
            n2 = "focus";
            k3 = Fd;
            break;
          case "focusout":
            n2 = "blur";
            k3 = Fd;
            break;
          case "beforeblur":
          case "afterblur":
            k3 = Fd;
            break;
          case "click":
            if (2 === c.button) break a;
          case "auxclick":
          case "dblclick":
          case "mousedown":
          case "mousemove":
          case "mouseup":
          case "mouseout":
          case "mouseover":
          case "contextmenu":
            k3 = Bd;
            break;
          case "drag":
          case "dragend":
          case "dragenter":
          case "dragexit":
          case "dragleave":
          case "dragover":
          case "dragstart":
          case "drop":
            k3 = Dd;
            break;
          case "touchcancel":
          case "touchend":
          case "touchmove":
          case "touchstart":
            k3 = Vd;
            break;
          case $e:
          case af:
          case bf:
            k3 = Hd;
            break;
          case cf:
            k3 = Xd;
            break;
          case "scroll":
            k3 = vd;
            break;
          case "wheel":
            k3 = Zd;
            break;
          case "copy":
          case "cut":
          case "paste":
            k3 = Jd;
            break;
          case "gotpointercapture":
          case "lostpointercapture":
          case "pointercancel":
          case "pointerdown":
          case "pointermove":
          case "pointerout":
          case "pointerover":
          case "pointerup":
            k3 = Td;
        }
        var t2 = 0 !== (b & 4), J2 = !t2 && "scroll" === a, x2 = t2 ? null !== h2 ? h2 + "Capture" : null : h2;
        t2 = [];
        for (var w2 = d2, u2; null !== w2; ) {
          u2 = w2;
          var F2 = u2.stateNode;
          5 === u2.tag && null !== F2 && (u2 = F2, null !== x2 && (F2 = Kb(w2, x2), null != F2 && t2.push(tf(w2, F2, u2))));
          if (J2) break;
          w2 = w2.return;
        }
        0 < t2.length && (h2 = new k3(h2, n2, null, c, e2), g2.push({ event: h2, listeners: t2 }));
      }
    }
    if (0 === (b & 7)) {
      a: {
        h2 = "mouseover" === a || "pointerover" === a;
        k3 = "mouseout" === a || "pointerout" === a;
        if (h2 && c !== wb && (n2 = c.relatedTarget || c.fromElement) && (Wc(n2) || n2[uf])) break a;
        if (k3 || h2) {
          h2 = e2.window === e2 ? e2 : (h2 = e2.ownerDocument) ? h2.defaultView || h2.parentWindow : window;
          if (k3) {
            if (n2 = c.relatedTarget || c.toElement, k3 = d2, n2 = n2 ? Wc(n2) : null, null !== n2 && (J2 = Vb(n2), n2 !== J2 || 5 !== n2.tag && 6 !== n2.tag)) n2 = null;
          } else k3 = null, n2 = d2;
          if (k3 !== n2) {
            t2 = Bd;
            F2 = "onMouseLeave";
            x2 = "onMouseEnter";
            w2 = "mouse";
            if ("pointerout" === a || "pointerover" === a) t2 = Td, F2 = "onPointerLeave", x2 = "onPointerEnter", w2 = "pointer";
            J2 = null == k3 ? h2 : ue(k3);
            u2 = null == n2 ? h2 : ue(n2);
            h2 = new t2(F2, w2 + "leave", k3, c, e2);
            h2.target = J2;
            h2.relatedTarget = u2;
            F2 = null;
            Wc(e2) === d2 && (t2 = new t2(x2, w2 + "enter", n2, c, e2), t2.target = u2, t2.relatedTarget = J2, F2 = t2);
            J2 = F2;
            if (k3 && n2) b: {
              t2 = k3;
              x2 = n2;
              w2 = 0;
              for (u2 = t2; u2; u2 = vf(u2)) w2++;
              u2 = 0;
              for (F2 = x2; F2; F2 = vf(F2)) u2++;
              for (; 0 < w2 - u2; ) t2 = vf(t2), w2--;
              for (; 0 < u2 - w2; ) x2 = vf(x2), u2--;
              for (; w2--; ) {
                if (t2 === x2 || null !== x2 && t2 === x2.alternate) break b;
                t2 = vf(t2);
                x2 = vf(x2);
              }
              t2 = null;
            }
            else t2 = null;
            null !== k3 && wf(g2, h2, k3, t2, false);
            null !== n2 && null !== J2 && wf(g2, J2, n2, t2, true);
          }
        }
      }
      a: {
        h2 = d2 ? ue(d2) : window;
        k3 = h2.nodeName && h2.nodeName.toLowerCase();
        if ("select" === k3 || "input" === k3 && "file" === h2.type) var na = ve;
        else if (me(h2)) if (we) na = Fe;
        else {
          na = De;
          var xa = Ce;
        }
        else (k3 = h2.nodeName) && "input" === k3.toLowerCase() && ("checkbox" === h2.type || "radio" === h2.type) && (na = Ee);
        if (na && (na = na(a, d2))) {
          ne(g2, na, c, e2);
          break a;
        }
        xa && xa(a, h2, d2);
        "focusout" === a && (xa = h2._wrapperState) && xa.controlled && "number" === h2.type && cb(h2, "number", h2.value);
      }
      xa = d2 ? ue(d2) : window;
      switch (a) {
        case "focusin":
          if (me(xa) || "true" === xa.contentEditable) Qe = xa, Re = d2, Se = null;
          break;
        case "focusout":
          Se = Re = Qe = null;
          break;
        case "mousedown":
          Te = true;
          break;
        case "contextmenu":
        case "mouseup":
        case "dragend":
          Te = false;
          Ue(g2, c, e2);
          break;
        case "selectionchange":
          if (Pe) break;
        case "keydown":
        case "keyup":
          Ue(g2, c, e2);
      }
      var $a;
      if (ae) b: {
        switch (a) {
          case "compositionstart":
            var ba = "onCompositionStart";
            break b;
          case "compositionend":
            ba = "onCompositionEnd";
            break b;
          case "compositionupdate":
            ba = "onCompositionUpdate";
            break b;
        }
        ba = void 0;
      }
      else ie ? ge(a, c) && (ba = "onCompositionEnd") : "keydown" === a && 229 === c.keyCode && (ba = "onCompositionStart");
      ba && (de && "ko" !== c.locale && (ie || "onCompositionStart" !== ba ? "onCompositionEnd" === ba && ie && ($a = nd()) : (kd = e2, ld = "value" in kd ? kd.value : kd.textContent, ie = true)), xa = oe(d2, ba), 0 < xa.length && (ba = new Ld(ba, a, null, c, e2), g2.push({ event: ba, listeners: xa }), $a ? ba.data = $a : ($a = he(c), null !== $a && (ba.data = $a))));
      if ($a = ce ? je(a, c) : ke(a, c)) d2 = oe(d2, "onBeforeInput"), 0 < d2.length && (e2 = new Ld("onBeforeInput", "beforeinput", null, c, e2), g2.push({ event: e2, listeners: d2 }), e2.data = $a);
    }
    se(g2, b);
  });
}
function tf(a, b, c) {
  return { instance: a, listener: b, currentTarget: c };
}
function oe(a, b) {
  for (var c = b + "Capture", d = []; null !== a; ) {
    var e = a, f2 = e.stateNode;
    5 === e.tag && null !== f2 && (e = f2, f2 = Kb(a, c), null != f2 && d.unshift(tf(a, f2, e)), f2 = Kb(a, b), null != f2 && d.push(tf(a, f2, e)));
    a = a.return;
  }
  return d;
}
function vf(a) {
  if (null === a) return null;
  do
    a = a.return;
  while (a && 5 !== a.tag);
  return a ? a : null;
}
function wf(a, b, c, d, e) {
  for (var f2 = b._reactName, g = []; null !== c && c !== d; ) {
    var h = c, k2 = h.alternate, l2 = h.stateNode;
    if (null !== k2 && k2 === d) break;
    5 === h.tag && null !== l2 && (h = l2, e ? (k2 = Kb(c, f2), null != k2 && g.unshift(tf(c, k2, h))) : e || (k2 = Kb(c, f2), null != k2 && g.push(tf(c, k2, h))));
    c = c.return;
  }
  0 !== g.length && a.push({ event: b, listeners: g });
}
var xf = /\r\n?/g, yf = /\u0000|\uFFFD/g;
function zf(a) {
  return ("string" === typeof a ? a : "" + a).replace(xf, "\n").replace(yf, "");
}
function Af(a, b, c) {
  b = zf(b);
  if (zf(a) !== b && c) throw Error(p(425));
}
function Bf() {
}
var Cf = null, Df = null;
function Ef(a, b) {
  return "textarea" === a || "noscript" === a || "string" === typeof b.children || "number" === typeof b.children || "object" === typeof b.dangerouslySetInnerHTML && null !== b.dangerouslySetInnerHTML && null != b.dangerouslySetInnerHTML.__html;
}
var Ff = "function" === typeof setTimeout ? setTimeout : void 0, Gf = "function" === typeof clearTimeout ? clearTimeout : void 0, Hf = "function" === typeof Promise ? Promise : void 0, Jf = "function" === typeof queueMicrotask ? queueMicrotask : "undefined" !== typeof Hf ? function(a) {
  return Hf.resolve(null).then(a).catch(If);
} : Ff;
function If(a) {
  setTimeout(function() {
    throw a;
  });
}
function Kf(a, b) {
  var c = b, d = 0;
  do {
    var e = c.nextSibling;
    a.removeChild(c);
    if (e && 8 === e.nodeType) if (c = e.data, "/$" === c) {
      if (0 === d) {
        a.removeChild(e);
        bd(b);
        return;
      }
      d--;
    } else "$" !== c && "$?" !== c && "$!" !== c || d++;
    c = e;
  } while (c);
  bd(b);
}
function Lf(a) {
  for (; null != a; a = a.nextSibling) {
    var b = a.nodeType;
    if (1 === b || 3 === b) break;
    if (8 === b) {
      b = a.data;
      if ("$" === b || "$!" === b || "$?" === b) break;
      if ("/$" === b) return null;
    }
  }
  return a;
}
function Mf(a) {
  a = a.previousSibling;
  for (var b = 0; a; ) {
    if (8 === a.nodeType) {
      var c = a.data;
      if ("$" === c || "$!" === c || "$?" === c) {
        if (0 === b) return a;
        b--;
      } else "/$" === c && b++;
    }
    a = a.previousSibling;
  }
  return null;
}
var Nf = Math.random().toString(36).slice(2), Of = "__reactFiber$" + Nf, Pf = "__reactProps$" + Nf, uf = "__reactContainer$" + Nf, of = "__reactEvents$" + Nf, Qf = "__reactListeners$" + Nf, Rf = "__reactHandles$" + Nf;
function Wc(a) {
  var b = a[Of];
  if (b) return b;
  for (var c = a.parentNode; c; ) {
    if (b = c[uf] || c[Of]) {
      c = b.alternate;
      if (null !== b.child || null !== c && null !== c.child) for (a = Mf(a); null !== a; ) {
        if (c = a[Of]) return c;
        a = Mf(a);
      }
      return b;
    }
    a = c;
    c = a.parentNode;
  }
  return null;
}
function Cb(a) {
  a = a[Of] || a[uf];
  return !a || 5 !== a.tag && 6 !== a.tag && 13 !== a.tag && 3 !== a.tag ? null : a;
}
function ue(a) {
  if (5 === a.tag || 6 === a.tag) return a.stateNode;
  throw Error(p(33));
}
function Db(a) {
  return a[Pf] || null;
}
var Sf = [], Tf = -1;
function Uf(a) {
  return { current: a };
}
function E(a) {
  0 > Tf || (a.current = Sf[Tf], Sf[Tf] = null, Tf--);
}
function G(a, b) {
  Tf++;
  Sf[Tf] = a.current;
  a.current = b;
}
var Vf = {}, H = Uf(Vf), Wf = Uf(false), Xf = Vf;
function Yf(a, b) {
  var c = a.type.contextTypes;
  if (!c) return Vf;
  var d = a.stateNode;
  if (d && d.__reactInternalMemoizedUnmaskedChildContext === b) return d.__reactInternalMemoizedMaskedChildContext;
  var e = {}, f2;
  for (f2 in c) e[f2] = b[f2];
  d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = b, a.__reactInternalMemoizedMaskedChildContext = e);
  return e;
}
function Zf(a) {
  a = a.childContextTypes;
  return null !== a && void 0 !== a;
}
function $f() {
  E(Wf);
  E(H);
}
function ag(a, b, c) {
  if (H.current !== Vf) throw Error(p(168));
  G(H, b);
  G(Wf, c);
}
function bg(a, b, c) {
  var d = a.stateNode;
  b = b.childContextTypes;
  if ("function" !== typeof d.getChildContext) return c;
  d = d.getChildContext();
  for (var e in d) if (!(e in b)) throw Error(p(108, Ra(a) || "Unknown", e));
  return A({}, c, d);
}
function cg(a) {
  a = (a = a.stateNode) && a.__reactInternalMemoizedMergedChildContext || Vf;
  Xf = H.current;
  G(H, a);
  G(Wf, Wf.current);
  return true;
}
function dg(a, b, c) {
  var d = a.stateNode;
  if (!d) throw Error(p(169));
  c ? (a = bg(a, b, Xf), d.__reactInternalMemoizedMergedChildContext = a, E(Wf), E(H), G(H, a)) : E(Wf);
  G(Wf, c);
}
var eg = null, fg = false, gg = false;
function hg(a) {
  null === eg ? eg = [a] : eg.push(a);
}
function ig(a) {
  fg = true;
  hg(a);
}
function jg() {
  if (!gg && null !== eg) {
    gg = true;
    var a = 0, b = C;
    try {
      var c = eg;
      for (C = 1; a < c.length; a++) {
        var d = c[a];
        do
          d = d(true);
        while (null !== d);
      }
      eg = null;
      fg = false;
    } catch (e) {
      throw null !== eg && (eg = eg.slice(a + 1)), ac(fc, jg), e;
    } finally {
      C = b, gg = false;
    }
  }
  return null;
}
var kg = [], lg = 0, mg = null, ng = 0, og = [], pg = 0, qg = null, rg = 1, sg = "";
function tg(a, b) {
  kg[lg++] = ng;
  kg[lg++] = mg;
  mg = a;
  ng = b;
}
function ug(a, b, c) {
  og[pg++] = rg;
  og[pg++] = sg;
  og[pg++] = qg;
  qg = a;
  var d = rg;
  a = sg;
  var e = 32 - oc(d) - 1;
  d &= ~(1 << e);
  c += 1;
  var f2 = 32 - oc(b) + e;
  if (30 < f2) {
    var g = e - e % 5;
    f2 = (d & (1 << g) - 1).toString(32);
    d >>= g;
    e -= g;
    rg = 1 << 32 - oc(b) + e | c << e | d;
    sg = f2 + a;
  } else rg = 1 << f2 | c << e | d, sg = a;
}
function vg(a) {
  null !== a.return && (tg(a, 1), ug(a, 1, 0));
}
function wg(a) {
  for (; a === mg; ) mg = kg[--lg], kg[lg] = null, ng = kg[--lg], kg[lg] = null;
  for (; a === qg; ) qg = og[--pg], og[pg] = null, sg = og[--pg], og[pg] = null, rg = og[--pg], og[pg] = null;
}
var xg = null, yg = null, I = false, zg = null;
function Ag(a, b) {
  var c = Bg(5, null, null, 0);
  c.elementType = "DELETED";
  c.stateNode = b;
  c.return = a;
  b = a.deletions;
  null === b ? (a.deletions = [c], a.flags |= 16) : b.push(c);
}
function Cg(a, b) {
  switch (a.tag) {
    case 5:
      var c = a.type;
      b = 1 !== b.nodeType || c.toLowerCase() !== b.nodeName.toLowerCase() ? null : b;
      return null !== b ? (a.stateNode = b, xg = a, yg = Lf(b.firstChild), true) : false;
    case 6:
      return b = "" === a.pendingProps || 3 !== b.nodeType ? null : b, null !== b ? (a.stateNode = b, xg = a, yg = null, true) : false;
    case 13:
      return b = 8 !== b.nodeType ? null : b, null !== b ? (c = null !== qg ? { id: rg, overflow: sg } : null, a.memoizedState = { dehydrated: b, treeContext: c, retryLane: 1073741824 }, c = Bg(18, null, null, 0), c.stateNode = b, c.return = a, a.child = c, xg = a, yg = null, true) : false;
    default:
      return false;
  }
}
function Dg(a) {
  return 0 !== (a.mode & 1) && 0 === (a.flags & 128);
}
function Eg(a) {
  if (I) {
    var b = yg;
    if (b) {
      var c = b;
      if (!Cg(a, b)) {
        if (Dg(a)) throw Error(p(418));
        b = Lf(c.nextSibling);
        var d = xg;
        b && Cg(a, b) ? Ag(d, c) : (a.flags = a.flags & -4097 | 2, I = false, xg = a);
      }
    } else {
      if (Dg(a)) throw Error(p(418));
      a.flags = a.flags & -4097 | 2;
      I = false;
      xg = a;
    }
  }
}
function Fg(a) {
  for (a = a.return; null !== a && 5 !== a.tag && 3 !== a.tag && 13 !== a.tag; ) a = a.return;
  xg = a;
}
function Gg(a) {
  if (a !== xg) return false;
  if (!I) return Fg(a), I = true, false;
  var b;
  (b = 3 !== a.tag) && !(b = 5 !== a.tag) && (b = a.type, b = "head" !== b && "body" !== b && !Ef(a.type, a.memoizedProps));
  if (b && (b = yg)) {
    if (Dg(a)) throw Hg(), Error(p(418));
    for (; b; ) Ag(a, b), b = Lf(b.nextSibling);
  }
  Fg(a);
  if (13 === a.tag) {
    a = a.memoizedState;
    a = null !== a ? a.dehydrated : null;
    if (!a) throw Error(p(317));
    a: {
      a = a.nextSibling;
      for (b = 0; a; ) {
        if (8 === a.nodeType) {
          var c = a.data;
          if ("/$" === c) {
            if (0 === b) {
              yg = Lf(a.nextSibling);
              break a;
            }
            b--;
          } else "$" !== c && "$!" !== c && "$?" !== c || b++;
        }
        a = a.nextSibling;
      }
      yg = null;
    }
  } else yg = xg ? Lf(a.stateNode.nextSibling) : null;
  return true;
}
function Hg() {
  for (var a = yg; a; ) a = Lf(a.nextSibling);
}
function Ig() {
  yg = xg = null;
  I = false;
}
function Jg(a) {
  null === zg ? zg = [a] : zg.push(a);
}
var Kg = ua.ReactCurrentBatchConfig;
function Lg(a, b, c) {
  a = c.ref;
  if (null !== a && "function" !== typeof a && "object" !== typeof a) {
    if (c._owner) {
      c = c._owner;
      if (c) {
        if (1 !== c.tag) throw Error(p(309));
        var d = c.stateNode;
      }
      if (!d) throw Error(p(147, a));
      var e = d, f2 = "" + a;
      if (null !== b && null !== b.ref && "function" === typeof b.ref && b.ref._stringRef === f2) return b.ref;
      b = function(a2) {
        var b2 = e.refs;
        null === a2 ? delete b2[f2] : b2[f2] = a2;
      };
      b._stringRef = f2;
      return b;
    }
    if ("string" !== typeof a) throw Error(p(284));
    if (!c._owner) throw Error(p(290, a));
  }
  return a;
}
function Mg(a, b) {
  a = Object.prototype.toString.call(b);
  throw Error(p(31, "[object Object]" === a ? "object with keys {" + Object.keys(b).join(", ") + "}" : a));
}
function Ng(a) {
  var b = a._init;
  return b(a._payload);
}
function Og(a) {
  function b(b2, c2) {
    if (a) {
      var d2 = b2.deletions;
      null === d2 ? (b2.deletions = [c2], b2.flags |= 16) : d2.push(c2);
    }
  }
  function c(c2, d2) {
    if (!a) return null;
    for (; null !== d2; ) b(c2, d2), d2 = d2.sibling;
    return null;
  }
  function d(a2, b2) {
    for (a2 = /* @__PURE__ */ new Map(); null !== b2; ) null !== b2.key ? a2.set(b2.key, b2) : a2.set(b2.index, b2), b2 = b2.sibling;
    return a2;
  }
  function e(a2, b2) {
    a2 = Pg(a2, b2);
    a2.index = 0;
    a2.sibling = null;
    return a2;
  }
  function f2(b2, c2, d2) {
    b2.index = d2;
    if (!a) return b2.flags |= 1048576, c2;
    d2 = b2.alternate;
    if (null !== d2) return d2 = d2.index, d2 < c2 ? (b2.flags |= 2, c2) : d2;
    b2.flags |= 2;
    return c2;
  }
  function g(b2) {
    a && null === b2.alternate && (b2.flags |= 2);
    return b2;
  }
  function h(a2, b2, c2, d2) {
    if (null === b2 || 6 !== b2.tag) return b2 = Qg(c2, a2.mode, d2), b2.return = a2, b2;
    b2 = e(b2, c2);
    b2.return = a2;
    return b2;
  }
  function k2(a2, b2, c2, d2) {
    var f3 = c2.type;
    if (f3 === ya) return m2(a2, b2, c2.props.children, d2, c2.key);
    if (null !== b2 && (b2.elementType === f3 || "object" === typeof f3 && null !== f3 && f3.$$typeof === Ha && Ng(f3) === b2.type)) return d2 = e(b2, c2.props), d2.ref = Lg(a2, b2, c2), d2.return = a2, d2;
    d2 = Rg(c2.type, c2.key, c2.props, null, a2.mode, d2);
    d2.ref = Lg(a2, b2, c2);
    d2.return = a2;
    return d2;
  }
  function l2(a2, b2, c2, d2) {
    if (null === b2 || 4 !== b2.tag || b2.stateNode.containerInfo !== c2.containerInfo || b2.stateNode.implementation !== c2.implementation) return b2 = Sg(c2, a2.mode, d2), b2.return = a2, b2;
    b2 = e(b2, c2.children || []);
    b2.return = a2;
    return b2;
  }
  function m2(a2, b2, c2, d2, f3) {
    if (null === b2 || 7 !== b2.tag) return b2 = Tg(c2, a2.mode, d2, f3), b2.return = a2, b2;
    b2 = e(b2, c2);
    b2.return = a2;
    return b2;
  }
  function q2(a2, b2, c2) {
    if ("string" === typeof b2 && "" !== b2 || "number" === typeof b2) return b2 = Qg("" + b2, a2.mode, c2), b2.return = a2, b2;
    if ("object" === typeof b2 && null !== b2) {
      switch (b2.$$typeof) {
        case va:
          return c2 = Rg(b2.type, b2.key, b2.props, null, a2.mode, c2), c2.ref = Lg(a2, null, b2), c2.return = a2, c2;
        case wa:
          return b2 = Sg(b2, a2.mode, c2), b2.return = a2, b2;
        case Ha:
          var d2 = b2._init;
          return q2(a2, d2(b2._payload), c2);
      }
      if (eb(b2) || Ka(b2)) return b2 = Tg(b2, a2.mode, c2, null), b2.return = a2, b2;
      Mg(a2, b2);
    }
    return null;
  }
  function r2(a2, b2, c2, d2) {
    var e2 = null !== b2 ? b2.key : null;
    if ("string" === typeof c2 && "" !== c2 || "number" === typeof c2) return null !== e2 ? null : h(a2, b2, "" + c2, d2);
    if ("object" === typeof c2 && null !== c2) {
      switch (c2.$$typeof) {
        case va:
          return c2.key === e2 ? k2(a2, b2, c2, d2) : null;
        case wa:
          return c2.key === e2 ? l2(a2, b2, c2, d2) : null;
        case Ha:
          return e2 = c2._init, r2(
            a2,
            b2,
            e2(c2._payload),
            d2
          );
      }
      if (eb(c2) || Ka(c2)) return null !== e2 ? null : m2(a2, b2, c2, d2, null);
      Mg(a2, c2);
    }
    return null;
  }
  function y2(a2, b2, c2, d2, e2) {
    if ("string" === typeof d2 && "" !== d2 || "number" === typeof d2) return a2 = a2.get(c2) || null, h(b2, a2, "" + d2, e2);
    if ("object" === typeof d2 && null !== d2) {
      switch (d2.$$typeof) {
        case va:
          return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, k2(b2, a2, d2, e2);
        case wa:
          return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, l2(b2, a2, d2, e2);
        case Ha:
          var f3 = d2._init;
          return y2(a2, b2, c2, f3(d2._payload), e2);
      }
      if (eb(d2) || Ka(d2)) return a2 = a2.get(c2) || null, m2(b2, a2, d2, e2, null);
      Mg(b2, d2);
    }
    return null;
  }
  function n2(e2, g2, h2, k3) {
    for (var l3 = null, m3 = null, u2 = g2, w2 = g2 = 0, x2 = null; null !== u2 && w2 < h2.length; w2++) {
      u2.index > w2 ? (x2 = u2, u2 = null) : x2 = u2.sibling;
      var n3 = r2(e2, u2, h2[w2], k3);
      if (null === n3) {
        null === u2 && (u2 = x2);
        break;
      }
      a && u2 && null === n3.alternate && b(e2, u2);
      g2 = f2(n3, g2, w2);
      null === m3 ? l3 = n3 : m3.sibling = n3;
      m3 = n3;
      u2 = x2;
    }
    if (w2 === h2.length) return c(e2, u2), I && tg(e2, w2), l3;
    if (null === u2) {
      for (; w2 < h2.length; w2++) u2 = q2(e2, h2[w2], k3), null !== u2 && (g2 = f2(u2, g2, w2), null === m3 ? l3 = u2 : m3.sibling = u2, m3 = u2);
      I && tg(e2, w2);
      return l3;
    }
    for (u2 = d(e2, u2); w2 < h2.length; w2++) x2 = y2(u2, e2, w2, h2[w2], k3), null !== x2 && (a && null !== x2.alternate && u2.delete(null === x2.key ? w2 : x2.key), g2 = f2(x2, g2, w2), null === m3 ? l3 = x2 : m3.sibling = x2, m3 = x2);
    a && u2.forEach(function(a2) {
      return b(e2, a2);
    });
    I && tg(e2, w2);
    return l3;
  }
  function t2(e2, g2, h2, k3) {
    var l3 = Ka(h2);
    if ("function" !== typeof l3) throw Error(p(150));
    h2 = l3.call(h2);
    if (null == h2) throw Error(p(151));
    for (var u2 = l3 = null, m3 = g2, w2 = g2 = 0, x2 = null, n3 = h2.next(); null !== m3 && !n3.done; w2++, n3 = h2.next()) {
      m3.index > w2 ? (x2 = m3, m3 = null) : x2 = m3.sibling;
      var t3 = r2(e2, m3, n3.value, k3);
      if (null === t3) {
        null === m3 && (m3 = x2);
        break;
      }
      a && m3 && null === t3.alternate && b(e2, m3);
      g2 = f2(t3, g2, w2);
      null === u2 ? l3 = t3 : u2.sibling = t3;
      u2 = t3;
      m3 = x2;
    }
    if (n3.done) return c(
      e2,
      m3
    ), I && tg(e2, w2), l3;
    if (null === m3) {
      for (; !n3.done; w2++, n3 = h2.next()) n3 = q2(e2, n3.value, k3), null !== n3 && (g2 = f2(n3, g2, w2), null === u2 ? l3 = n3 : u2.sibling = n3, u2 = n3);
      I && tg(e2, w2);
      return l3;
    }
    for (m3 = d(e2, m3); !n3.done; w2++, n3 = h2.next()) n3 = y2(m3, e2, w2, n3.value, k3), null !== n3 && (a && null !== n3.alternate && m3.delete(null === n3.key ? w2 : n3.key), g2 = f2(n3, g2, w2), null === u2 ? l3 = n3 : u2.sibling = n3, u2 = n3);
    a && m3.forEach(function(a2) {
      return b(e2, a2);
    });
    I && tg(e2, w2);
    return l3;
  }
  function J2(a2, d2, f3, h2) {
    "object" === typeof f3 && null !== f3 && f3.type === ya && null === f3.key && (f3 = f3.props.children);
    if ("object" === typeof f3 && null !== f3) {
      switch (f3.$$typeof) {
        case va:
          a: {
            for (var k3 = f3.key, l3 = d2; null !== l3; ) {
              if (l3.key === k3) {
                k3 = f3.type;
                if (k3 === ya) {
                  if (7 === l3.tag) {
                    c(a2, l3.sibling);
                    d2 = e(l3, f3.props.children);
                    d2.return = a2;
                    a2 = d2;
                    break a;
                  }
                } else if (l3.elementType === k3 || "object" === typeof k3 && null !== k3 && k3.$$typeof === Ha && Ng(k3) === l3.type) {
                  c(a2, l3.sibling);
                  d2 = e(l3, f3.props);
                  d2.ref = Lg(a2, l3, f3);
                  d2.return = a2;
                  a2 = d2;
                  break a;
                }
                c(a2, l3);
                break;
              } else b(a2, l3);
              l3 = l3.sibling;
            }
            f3.type === ya ? (d2 = Tg(f3.props.children, a2.mode, h2, f3.key), d2.return = a2, a2 = d2) : (h2 = Rg(f3.type, f3.key, f3.props, null, a2.mode, h2), h2.ref = Lg(a2, d2, f3), h2.return = a2, a2 = h2);
          }
          return g(a2);
        case wa:
          a: {
            for (l3 = f3.key; null !== d2; ) {
              if (d2.key === l3) if (4 === d2.tag && d2.stateNode.containerInfo === f3.containerInfo && d2.stateNode.implementation === f3.implementation) {
                c(a2, d2.sibling);
                d2 = e(d2, f3.children || []);
                d2.return = a2;
                a2 = d2;
                break a;
              } else {
                c(a2, d2);
                break;
              }
              else b(a2, d2);
              d2 = d2.sibling;
            }
            d2 = Sg(f3, a2.mode, h2);
            d2.return = a2;
            a2 = d2;
          }
          return g(a2);
        case Ha:
          return l3 = f3._init, J2(a2, d2, l3(f3._payload), h2);
      }
      if (eb(f3)) return n2(a2, d2, f3, h2);
      if (Ka(f3)) return t2(a2, d2, f3, h2);
      Mg(a2, f3);
    }
    return "string" === typeof f3 && "" !== f3 || "number" === typeof f3 ? (f3 = "" + f3, null !== d2 && 6 === d2.tag ? (c(a2, d2.sibling), d2 = e(d2, f3), d2.return = a2, a2 = d2) : (c(a2, d2), d2 = Qg(f3, a2.mode, h2), d2.return = a2, a2 = d2), g(a2)) : c(a2, d2);
  }
  return J2;
}
var Ug = Og(true), Vg = Og(false), Wg = Uf(null), Xg = null, Yg = null, Zg = null;
function $g() {
  Zg = Yg = Xg = null;
}
function ah(a) {
  var b = Wg.current;
  E(Wg);
  a._currentValue = b;
}
function bh(a, b, c) {
  for (; null !== a; ) {
    var d = a.alternate;
    (a.childLanes & b) !== b ? (a.childLanes |= b, null !== d && (d.childLanes |= b)) : null !== d && (d.childLanes & b) !== b && (d.childLanes |= b);
    if (a === c) break;
    a = a.return;
  }
}
function ch(a, b) {
  Xg = a;
  Zg = Yg = null;
  a = a.dependencies;
  null !== a && null !== a.firstContext && (0 !== (a.lanes & b) && (dh = true), a.firstContext = null);
}
function eh(a) {
  var b = a._currentValue;
  if (Zg !== a) if (a = { context: a, memoizedValue: b, next: null }, null === Yg) {
    if (null === Xg) throw Error(p(308));
    Yg = a;
    Xg.dependencies = { lanes: 0, firstContext: a };
  } else Yg = Yg.next = a;
  return b;
}
var fh = null;
function gh(a) {
  null === fh ? fh = [a] : fh.push(a);
}
function hh(a, b, c, d) {
  var e = b.interleaved;
  null === e ? (c.next = c, gh(b)) : (c.next = e.next, e.next = c);
  b.interleaved = c;
  return ih(a, d);
}
function ih(a, b) {
  a.lanes |= b;
  var c = a.alternate;
  null !== c && (c.lanes |= b);
  c = a;
  for (a = a.return; null !== a; ) a.childLanes |= b, c = a.alternate, null !== c && (c.childLanes |= b), c = a, a = a.return;
  return 3 === c.tag ? c.stateNode : null;
}
var jh = false;
function kh(a) {
  a.updateQueue = { baseState: a.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, interleaved: null, lanes: 0 }, effects: null };
}
function lh(a, b) {
  a = a.updateQueue;
  b.updateQueue === a && (b.updateQueue = { baseState: a.baseState, firstBaseUpdate: a.firstBaseUpdate, lastBaseUpdate: a.lastBaseUpdate, shared: a.shared, effects: a.effects });
}
function mh(a, b) {
  return { eventTime: a, lane: b, tag: 0, payload: null, callback: null, next: null };
}
function nh(a, b, c) {
  var d = a.updateQueue;
  if (null === d) return null;
  d = d.shared;
  if (0 !== (K & 2)) {
    var e = d.pending;
    null === e ? b.next = b : (b.next = e.next, e.next = b);
    d.pending = b;
    return ih(a, c);
  }
  e = d.interleaved;
  null === e ? (b.next = b, gh(d)) : (b.next = e.next, e.next = b);
  d.interleaved = b;
  return ih(a, c);
}
function oh(a, b, c) {
  b = b.updateQueue;
  if (null !== b && (b = b.shared, 0 !== (c & 4194240))) {
    var d = b.lanes;
    d &= a.pendingLanes;
    c |= d;
    b.lanes = c;
    Cc(a, c);
  }
}
function ph(a, b) {
  var c = a.updateQueue, d = a.alternate;
  if (null !== d && (d = d.updateQueue, c === d)) {
    var e = null, f2 = null;
    c = c.firstBaseUpdate;
    if (null !== c) {
      do {
        var g = { eventTime: c.eventTime, lane: c.lane, tag: c.tag, payload: c.payload, callback: c.callback, next: null };
        null === f2 ? e = f2 = g : f2 = f2.next = g;
        c = c.next;
      } while (null !== c);
      null === f2 ? e = f2 = b : f2 = f2.next = b;
    } else e = f2 = b;
    c = { baseState: d.baseState, firstBaseUpdate: e, lastBaseUpdate: f2, shared: d.shared, effects: d.effects };
    a.updateQueue = c;
    return;
  }
  a = c.lastBaseUpdate;
  null === a ? c.firstBaseUpdate = b : a.next = b;
  c.lastBaseUpdate = b;
}
function qh(a, b, c, d) {
  var e = a.updateQueue;
  jh = false;
  var f2 = e.firstBaseUpdate, g = e.lastBaseUpdate, h = e.shared.pending;
  if (null !== h) {
    e.shared.pending = null;
    var k2 = h, l2 = k2.next;
    k2.next = null;
    null === g ? f2 = l2 : g.next = l2;
    g = k2;
    var m2 = a.alternate;
    null !== m2 && (m2 = m2.updateQueue, h = m2.lastBaseUpdate, h !== g && (null === h ? m2.firstBaseUpdate = l2 : h.next = l2, m2.lastBaseUpdate = k2));
  }
  if (null !== f2) {
    var q2 = e.baseState;
    g = 0;
    m2 = l2 = k2 = null;
    h = f2;
    do {
      var r2 = h.lane, y2 = h.eventTime;
      if ((d & r2) === r2) {
        null !== m2 && (m2 = m2.next = {
          eventTime: y2,
          lane: 0,
          tag: h.tag,
          payload: h.payload,
          callback: h.callback,
          next: null
        });
        a: {
          var n2 = a, t2 = h;
          r2 = b;
          y2 = c;
          switch (t2.tag) {
            case 1:
              n2 = t2.payload;
              if ("function" === typeof n2) {
                q2 = n2.call(y2, q2, r2);
                break a;
              }
              q2 = n2;
              break a;
            case 3:
              n2.flags = n2.flags & -65537 | 128;
            case 0:
              n2 = t2.payload;
              r2 = "function" === typeof n2 ? n2.call(y2, q2, r2) : n2;
              if (null === r2 || void 0 === r2) break a;
              q2 = A({}, q2, r2);
              break a;
            case 2:
              jh = true;
          }
        }
        null !== h.callback && 0 !== h.lane && (a.flags |= 64, r2 = e.effects, null === r2 ? e.effects = [h] : r2.push(h));
      } else y2 = { eventTime: y2, lane: r2, tag: h.tag, payload: h.payload, callback: h.callback, next: null }, null === m2 ? (l2 = m2 = y2, k2 = q2) : m2 = m2.next = y2, g |= r2;
      h = h.next;
      if (null === h) if (h = e.shared.pending, null === h) break;
      else r2 = h, h = r2.next, r2.next = null, e.lastBaseUpdate = r2, e.shared.pending = null;
    } while (1);
    null === m2 && (k2 = q2);
    e.baseState = k2;
    e.firstBaseUpdate = l2;
    e.lastBaseUpdate = m2;
    b = e.shared.interleaved;
    if (null !== b) {
      e = b;
      do
        g |= e.lane, e = e.next;
      while (e !== b);
    } else null === f2 && (e.shared.lanes = 0);
    rh |= g;
    a.lanes = g;
    a.memoizedState = q2;
  }
}
function sh(a, b, c) {
  a = b.effects;
  b.effects = null;
  if (null !== a) for (b = 0; b < a.length; b++) {
    var d = a[b], e = d.callback;
    if (null !== e) {
      d.callback = null;
      d = c;
      if ("function" !== typeof e) throw Error(p(191, e));
      e.call(d);
    }
  }
}
var th = {}, uh = Uf(th), vh = Uf(th), wh = Uf(th);
function xh(a) {
  if (a === th) throw Error(p(174));
  return a;
}
function yh(a, b) {
  G(wh, b);
  G(vh, a);
  G(uh, th);
  a = b.nodeType;
  switch (a) {
    case 9:
    case 11:
      b = (b = b.documentElement) ? b.namespaceURI : lb(null, "");
      break;
    default:
      a = 8 === a ? b.parentNode : b, b = a.namespaceURI || null, a = a.tagName, b = lb(b, a);
  }
  E(uh);
  G(uh, b);
}
function zh() {
  E(uh);
  E(vh);
  E(wh);
}
function Ah(a) {
  xh(wh.current);
  var b = xh(uh.current);
  var c = lb(b, a.type);
  b !== c && (G(vh, a), G(uh, c));
}
function Bh(a) {
  vh.current === a && (E(uh), E(vh));
}
var L = Uf(0);
function Ch(a) {
  for (var b = a; null !== b; ) {
    if (13 === b.tag) {
      var c = b.memoizedState;
      if (null !== c && (c = c.dehydrated, null === c || "$?" === c.data || "$!" === c.data)) return b;
    } else if (19 === b.tag && void 0 !== b.memoizedProps.revealOrder) {
      if (0 !== (b.flags & 128)) return b;
    } else if (null !== b.child) {
      b.child.return = b;
      b = b.child;
      continue;
    }
    if (b === a) break;
    for (; null === b.sibling; ) {
      if (null === b.return || b.return === a) return null;
      b = b.return;
    }
    b.sibling.return = b.return;
    b = b.sibling;
  }
  return null;
}
var Dh = [];
function Eh() {
  for (var a = 0; a < Dh.length; a++) Dh[a]._workInProgressVersionPrimary = null;
  Dh.length = 0;
}
var Fh = ua.ReactCurrentDispatcher, Gh = ua.ReactCurrentBatchConfig, Hh = 0, M = null, N = null, O = null, Ih = false, Jh = false, Kh = 0, Lh = 0;
function P() {
  throw Error(p(321));
}
function Mh(a, b) {
  if (null === b) return false;
  for (var c = 0; c < b.length && c < a.length; c++) if (!He(a[c], b[c])) return false;
  return true;
}
function Nh(a, b, c, d, e, f2) {
  Hh = f2;
  M = b;
  b.memoizedState = null;
  b.updateQueue = null;
  b.lanes = 0;
  Fh.current = null === a || null === a.memoizedState ? Oh : Ph;
  a = c(d, e);
  if (Jh) {
    f2 = 0;
    do {
      Jh = false;
      Kh = 0;
      if (25 <= f2) throw Error(p(301));
      f2 += 1;
      O = N = null;
      b.updateQueue = null;
      Fh.current = Qh;
      a = c(d, e);
    } while (Jh);
  }
  Fh.current = Rh;
  b = null !== N && null !== N.next;
  Hh = 0;
  O = N = M = null;
  Ih = false;
  if (b) throw Error(p(300));
  return a;
}
function Sh() {
  var a = 0 !== Kh;
  Kh = 0;
  return a;
}
function Th() {
  var a = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
  null === O ? M.memoizedState = O = a : O = O.next = a;
  return O;
}
function Uh() {
  if (null === N) {
    var a = M.alternate;
    a = null !== a ? a.memoizedState : null;
  } else a = N.next;
  var b = null === O ? M.memoizedState : O.next;
  if (null !== b) O = b, N = a;
  else {
    if (null === a) throw Error(p(310));
    N = a;
    a = { memoizedState: N.memoizedState, baseState: N.baseState, baseQueue: N.baseQueue, queue: N.queue, next: null };
    null === O ? M.memoizedState = O = a : O = O.next = a;
  }
  return O;
}
function Vh(a, b) {
  return "function" === typeof b ? b(a) : b;
}
function Wh(a) {
  var b = Uh(), c = b.queue;
  if (null === c) throw Error(p(311));
  c.lastRenderedReducer = a;
  var d = N, e = d.baseQueue, f2 = c.pending;
  if (null !== f2) {
    if (null !== e) {
      var g = e.next;
      e.next = f2.next;
      f2.next = g;
    }
    d.baseQueue = e = f2;
    c.pending = null;
  }
  if (null !== e) {
    f2 = e.next;
    d = d.baseState;
    var h = g = null, k2 = null, l2 = f2;
    do {
      var m2 = l2.lane;
      if ((Hh & m2) === m2) null !== k2 && (k2 = k2.next = { lane: 0, action: l2.action, hasEagerState: l2.hasEagerState, eagerState: l2.eagerState, next: null }), d = l2.hasEagerState ? l2.eagerState : a(d, l2.action);
      else {
        var q2 = {
          lane: m2,
          action: l2.action,
          hasEagerState: l2.hasEagerState,
          eagerState: l2.eagerState,
          next: null
        };
        null === k2 ? (h = k2 = q2, g = d) : k2 = k2.next = q2;
        M.lanes |= m2;
        rh |= m2;
      }
      l2 = l2.next;
    } while (null !== l2 && l2 !== f2);
    null === k2 ? g = d : k2.next = h;
    He(d, b.memoizedState) || (dh = true);
    b.memoizedState = d;
    b.baseState = g;
    b.baseQueue = k2;
    c.lastRenderedState = d;
  }
  a = c.interleaved;
  if (null !== a) {
    e = a;
    do
      f2 = e.lane, M.lanes |= f2, rh |= f2, e = e.next;
    while (e !== a);
  } else null === e && (c.lanes = 0);
  return [b.memoizedState, c.dispatch];
}
function Xh(a) {
  var b = Uh(), c = b.queue;
  if (null === c) throw Error(p(311));
  c.lastRenderedReducer = a;
  var d = c.dispatch, e = c.pending, f2 = b.memoizedState;
  if (null !== e) {
    c.pending = null;
    var g = e = e.next;
    do
      f2 = a(f2, g.action), g = g.next;
    while (g !== e);
    He(f2, b.memoizedState) || (dh = true);
    b.memoizedState = f2;
    null === b.baseQueue && (b.baseState = f2);
    c.lastRenderedState = f2;
  }
  return [f2, d];
}
function Yh() {
}
function Zh(a, b) {
  var c = M, d = Uh(), e = b(), f2 = !He(d.memoizedState, e);
  f2 && (d.memoizedState = e, dh = true);
  d = d.queue;
  $h(ai.bind(null, c, d, a), [a]);
  if (d.getSnapshot !== b || f2 || null !== O && O.memoizedState.tag & 1) {
    c.flags |= 2048;
    bi(9, ci.bind(null, c, d, e, b), void 0, null);
    if (null === Q) throw Error(p(349));
    0 !== (Hh & 30) || di(c, b, e);
  }
  return e;
}
function di(a, b, c) {
  a.flags |= 16384;
  a = { getSnapshot: b, value: c };
  b = M.updateQueue;
  null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.stores = [a]) : (c = b.stores, null === c ? b.stores = [a] : c.push(a));
}
function ci(a, b, c, d) {
  b.value = c;
  b.getSnapshot = d;
  ei(b) && fi(a);
}
function ai(a, b, c) {
  return c(function() {
    ei(b) && fi(a);
  });
}
function ei(a) {
  var b = a.getSnapshot;
  a = a.value;
  try {
    var c = b();
    return !He(a, c);
  } catch (d) {
    return true;
  }
}
function fi(a) {
  var b = ih(a, 1);
  null !== b && gi(b, a, 1, -1);
}
function hi(a) {
  var b = Th();
  "function" === typeof a && (a = a());
  b.memoizedState = b.baseState = a;
  a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: Vh, lastRenderedState: a };
  b.queue = a;
  a = a.dispatch = ii.bind(null, M, a);
  return [b.memoizedState, a];
}
function bi(a, b, c, d) {
  a = { tag: a, create: b, destroy: c, deps: d, next: null };
  b = M.updateQueue;
  null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.lastEffect = a.next = a) : (c = b.lastEffect, null === c ? b.lastEffect = a.next = a : (d = c.next, c.next = a, a.next = d, b.lastEffect = a));
  return a;
}
function ji() {
  return Uh().memoizedState;
}
function ki(a, b, c, d) {
  var e = Th();
  M.flags |= a;
  e.memoizedState = bi(1 | b, c, void 0, void 0 === d ? null : d);
}
function li(a, b, c, d) {
  var e = Uh();
  d = void 0 === d ? null : d;
  var f2 = void 0;
  if (null !== N) {
    var g = N.memoizedState;
    f2 = g.destroy;
    if (null !== d && Mh(d, g.deps)) {
      e.memoizedState = bi(b, c, f2, d);
      return;
    }
  }
  M.flags |= a;
  e.memoizedState = bi(1 | b, c, f2, d);
}
function mi(a, b) {
  return ki(8390656, 8, a, b);
}
function $h(a, b) {
  return li(2048, 8, a, b);
}
function ni(a, b) {
  return li(4, 2, a, b);
}
function oi(a, b) {
  return li(4, 4, a, b);
}
function pi(a, b) {
  if ("function" === typeof b) return a = a(), b(a), function() {
    b(null);
  };
  if (null !== b && void 0 !== b) return a = a(), b.current = a, function() {
    b.current = null;
  };
}
function qi(a, b, c) {
  c = null !== c && void 0 !== c ? c.concat([a]) : null;
  return li(4, 4, pi.bind(null, b, a), c);
}
function ri() {
}
function si(a, b) {
  var c = Uh();
  b = void 0 === b ? null : b;
  var d = c.memoizedState;
  if (null !== d && null !== b && Mh(b, d[1])) return d[0];
  c.memoizedState = [a, b];
  return a;
}
function ti(a, b) {
  var c = Uh();
  b = void 0 === b ? null : b;
  var d = c.memoizedState;
  if (null !== d && null !== b && Mh(b, d[1])) return d[0];
  a = a();
  c.memoizedState = [a, b];
  return a;
}
function ui(a, b, c) {
  if (0 === (Hh & 21)) return a.baseState && (a.baseState = false, dh = true), a.memoizedState = c;
  He(c, b) || (c = yc(), M.lanes |= c, rh |= c, a.baseState = true);
  return b;
}
function vi(a, b) {
  var c = C;
  C = 0 !== c && 4 > c ? c : 4;
  a(true);
  var d = Gh.transition;
  Gh.transition = {};
  try {
    a(false), b();
  } finally {
    C = c, Gh.transition = d;
  }
}
function wi() {
  return Uh().memoizedState;
}
function xi(a, b, c) {
  var d = yi(a);
  c = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
  if (zi(a)) Ai(b, c);
  else if (c = hh(a, b, c, d), null !== c) {
    var e = R();
    gi(c, a, d, e);
    Bi(c, b, d);
  }
}
function ii(a, b, c) {
  var d = yi(a), e = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
  if (zi(a)) Ai(b, e);
  else {
    var f2 = a.alternate;
    if (0 === a.lanes && (null === f2 || 0 === f2.lanes) && (f2 = b.lastRenderedReducer, null !== f2)) try {
      var g = b.lastRenderedState, h = f2(g, c);
      e.hasEagerState = true;
      e.eagerState = h;
      if (He(h, g)) {
        var k2 = b.interleaved;
        null === k2 ? (e.next = e, gh(b)) : (e.next = k2.next, k2.next = e);
        b.interleaved = e;
        return;
      }
    } catch (l2) {
    } finally {
    }
    c = hh(a, b, e, d);
    null !== c && (e = R(), gi(c, a, d, e), Bi(c, b, d));
  }
}
function zi(a) {
  var b = a.alternate;
  return a === M || null !== b && b === M;
}
function Ai(a, b) {
  Jh = Ih = true;
  var c = a.pending;
  null === c ? b.next = b : (b.next = c.next, c.next = b);
  a.pending = b;
}
function Bi(a, b, c) {
  if (0 !== (c & 4194240)) {
    var d = b.lanes;
    d &= a.pendingLanes;
    c |= d;
    b.lanes = c;
    Cc(a, c);
  }
}
var Rh = { readContext: eh, useCallback: P, useContext: P, useEffect: P, useImperativeHandle: P, useInsertionEffect: P, useLayoutEffect: P, useMemo: P, useReducer: P, useRef: P, useState: P, useDebugValue: P, useDeferredValue: P, useTransition: P, useMutableSource: P, useSyncExternalStore: P, useId: P, unstable_isNewReconciler: false }, Oh = { readContext: eh, useCallback: function(a, b) {
  Th().memoizedState = [a, void 0 === b ? null : b];
  return a;
}, useContext: eh, useEffect: mi, useImperativeHandle: function(a, b, c) {
  c = null !== c && void 0 !== c ? c.concat([a]) : null;
  return ki(
    4194308,
    4,
    pi.bind(null, b, a),
    c
  );
}, useLayoutEffect: function(a, b) {
  return ki(4194308, 4, a, b);
}, useInsertionEffect: function(a, b) {
  return ki(4, 2, a, b);
}, useMemo: function(a, b) {
  var c = Th();
  b = void 0 === b ? null : b;
  a = a();
  c.memoizedState = [a, b];
  return a;
}, useReducer: function(a, b, c) {
  var d = Th();
  b = void 0 !== c ? c(b) : b;
  d.memoizedState = d.baseState = b;
  a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: a, lastRenderedState: b };
  d.queue = a;
  a = a.dispatch = xi.bind(null, M, a);
  return [d.memoizedState, a];
}, useRef: function(a) {
  var b = Th();
  a = { current: a };
  return b.memoizedState = a;
}, useState: hi, useDebugValue: ri, useDeferredValue: function(a) {
  return Th().memoizedState = a;
}, useTransition: function() {
  var a = hi(false), b = a[0];
  a = vi.bind(null, a[1]);
  Th().memoizedState = a;
  return [b, a];
}, useMutableSource: function() {
}, useSyncExternalStore: function(a, b, c) {
  var d = M, e = Th();
  if (I) {
    if (void 0 === c) throw Error(p(407));
    c = c();
  } else {
    c = b();
    if (null === Q) throw Error(p(349));
    0 !== (Hh & 30) || di(d, b, c);
  }
  e.memoizedState = c;
  var f2 = { value: c, getSnapshot: b };
  e.queue = f2;
  mi(ai.bind(
    null,
    d,
    f2,
    a
  ), [a]);
  d.flags |= 2048;
  bi(9, ci.bind(null, d, f2, c, b), void 0, null);
  return c;
}, useId: function() {
  var a = Th(), b = Q.identifierPrefix;
  if (I) {
    var c = sg;
    var d = rg;
    c = (d & ~(1 << 32 - oc(d) - 1)).toString(32) + c;
    b = ":" + b + "R" + c;
    c = Kh++;
    0 < c && (b += "H" + c.toString(32));
    b += ":";
  } else c = Lh++, b = ":" + b + "r" + c.toString(32) + ":";
  return a.memoizedState = b;
}, unstable_isNewReconciler: false }, Ph = {
  readContext: eh,
  useCallback: si,
  useContext: eh,
  useEffect: $h,
  useImperativeHandle: qi,
  useInsertionEffect: ni,
  useLayoutEffect: oi,
  useMemo: ti,
  useReducer: Wh,
  useRef: ji,
  useState: function() {
    return Wh(Vh);
  },
  useDebugValue: ri,
  useDeferredValue: function(a) {
    var b = Uh();
    return ui(b, N.memoizedState, a);
  },
  useTransition: function() {
    var a = Wh(Vh)[0], b = Uh().memoizedState;
    return [a, b];
  },
  useMutableSource: Yh,
  useSyncExternalStore: Zh,
  useId: wi,
  unstable_isNewReconciler: false
}, Qh = { readContext: eh, useCallback: si, useContext: eh, useEffect: $h, useImperativeHandle: qi, useInsertionEffect: ni, useLayoutEffect: oi, useMemo: ti, useReducer: Xh, useRef: ji, useState: function() {
  return Xh(Vh);
}, useDebugValue: ri, useDeferredValue: function(a) {
  var b = Uh();
  return null === N ? b.memoizedState = a : ui(b, N.memoizedState, a);
}, useTransition: function() {
  var a = Xh(Vh)[0], b = Uh().memoizedState;
  return [a, b];
}, useMutableSource: Yh, useSyncExternalStore: Zh, useId: wi, unstable_isNewReconciler: false };
function Ci(a, b) {
  if (a && a.defaultProps) {
    b = A({}, b);
    a = a.defaultProps;
    for (var c in a) void 0 === b[c] && (b[c] = a[c]);
    return b;
  }
  return b;
}
function Di(a, b, c, d) {
  b = a.memoizedState;
  c = c(d, b);
  c = null === c || void 0 === c ? b : A({}, b, c);
  a.memoizedState = c;
  0 === a.lanes && (a.updateQueue.baseState = c);
}
var Ei = { isMounted: function(a) {
  return (a = a._reactInternals) ? Vb(a) === a : false;
}, enqueueSetState: function(a, b, c) {
  a = a._reactInternals;
  var d = R(), e = yi(a), f2 = mh(d, e);
  f2.payload = b;
  void 0 !== c && null !== c && (f2.callback = c);
  b = nh(a, f2, e);
  null !== b && (gi(b, a, e, d), oh(b, a, e));
}, enqueueReplaceState: function(a, b, c) {
  a = a._reactInternals;
  var d = R(), e = yi(a), f2 = mh(d, e);
  f2.tag = 1;
  f2.payload = b;
  void 0 !== c && null !== c && (f2.callback = c);
  b = nh(a, f2, e);
  null !== b && (gi(b, a, e, d), oh(b, a, e));
}, enqueueForceUpdate: function(a, b) {
  a = a._reactInternals;
  var c = R(), d = yi(a), e = mh(c, d);
  e.tag = 2;
  void 0 !== b && null !== b && (e.callback = b);
  b = nh(a, e, d);
  null !== b && (gi(b, a, d, c), oh(b, a, d));
} };
function Fi(a, b, c, d, e, f2, g) {
  a = a.stateNode;
  return "function" === typeof a.shouldComponentUpdate ? a.shouldComponentUpdate(d, f2, g) : b.prototype && b.prototype.isPureReactComponent ? !Ie(c, d) || !Ie(e, f2) : true;
}
function Gi(a, b, c) {
  var d = false, e = Vf;
  var f2 = b.contextType;
  "object" === typeof f2 && null !== f2 ? f2 = eh(f2) : (e = Zf(b) ? Xf : H.current, d = b.contextTypes, f2 = (d = null !== d && void 0 !== d) ? Yf(a, e) : Vf);
  b = new b(c, f2);
  a.memoizedState = null !== b.state && void 0 !== b.state ? b.state : null;
  b.updater = Ei;
  a.stateNode = b;
  b._reactInternals = a;
  d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = e, a.__reactInternalMemoizedMaskedChildContext = f2);
  return b;
}
function Hi(a, b, c, d) {
  a = b.state;
  "function" === typeof b.componentWillReceiveProps && b.componentWillReceiveProps(c, d);
  "function" === typeof b.UNSAFE_componentWillReceiveProps && b.UNSAFE_componentWillReceiveProps(c, d);
  b.state !== a && Ei.enqueueReplaceState(b, b.state, null);
}
function Ii(a, b, c, d) {
  var e = a.stateNode;
  e.props = c;
  e.state = a.memoizedState;
  e.refs = {};
  kh(a);
  var f2 = b.contextType;
  "object" === typeof f2 && null !== f2 ? e.context = eh(f2) : (f2 = Zf(b) ? Xf : H.current, e.context = Yf(a, f2));
  e.state = a.memoizedState;
  f2 = b.getDerivedStateFromProps;
  "function" === typeof f2 && (Di(a, b, f2, c), e.state = a.memoizedState);
  "function" === typeof b.getDerivedStateFromProps || "function" === typeof e.getSnapshotBeforeUpdate || "function" !== typeof e.UNSAFE_componentWillMount && "function" !== typeof e.componentWillMount || (b = e.state, "function" === typeof e.componentWillMount && e.componentWillMount(), "function" === typeof e.UNSAFE_componentWillMount && e.UNSAFE_componentWillMount(), b !== e.state && Ei.enqueueReplaceState(e, e.state, null), qh(a, c, e, d), e.state = a.memoizedState);
  "function" === typeof e.componentDidMount && (a.flags |= 4194308);
}
function Ji(a, b) {
  try {
    var c = "", d = b;
    do
      c += Pa(d), d = d.return;
    while (d);
    var e = c;
  } catch (f2) {
    e = "\nError generating stack: " + f2.message + "\n" + f2.stack;
  }
  return { value: a, source: b, stack: e, digest: null };
}
function Ki(a, b, c) {
  return { value: a, source: null, stack: null != c ? c : null, digest: null != b ? b : null };
}
function Li(a, b) {
  try {
    console.error(b.value);
  } catch (c) {
    setTimeout(function() {
      throw c;
    });
  }
}
var Mi = "function" === typeof WeakMap ? WeakMap : Map;
function Ni(a, b, c) {
  c = mh(-1, c);
  c.tag = 3;
  c.payload = { element: null };
  var d = b.value;
  c.callback = function() {
    Oi || (Oi = true, Pi = d);
    Li(a, b);
  };
  return c;
}
function Qi(a, b, c) {
  c = mh(-1, c);
  c.tag = 3;
  var d = a.type.getDerivedStateFromError;
  if ("function" === typeof d) {
    var e = b.value;
    c.payload = function() {
      return d(e);
    };
    c.callback = function() {
      Li(a, b);
    };
  }
  var f2 = a.stateNode;
  null !== f2 && "function" === typeof f2.componentDidCatch && (c.callback = function() {
    Li(a, b);
    "function" !== typeof d && (null === Ri ? Ri = /* @__PURE__ */ new Set([this]) : Ri.add(this));
    var c2 = b.stack;
    this.componentDidCatch(b.value, { componentStack: null !== c2 ? c2 : "" });
  });
  return c;
}
function Si(a, b, c) {
  var d = a.pingCache;
  if (null === d) {
    d = a.pingCache = new Mi();
    var e = /* @__PURE__ */ new Set();
    d.set(b, e);
  } else e = d.get(b), void 0 === e && (e = /* @__PURE__ */ new Set(), d.set(b, e));
  e.has(c) || (e.add(c), a = Ti.bind(null, a, b, c), b.then(a, a));
}
function Ui(a) {
  do {
    var b;
    if (b = 13 === a.tag) b = a.memoizedState, b = null !== b ? null !== b.dehydrated ? true : false : true;
    if (b) return a;
    a = a.return;
  } while (null !== a);
  return null;
}
function Vi(a, b, c, d, e) {
  if (0 === (a.mode & 1)) return a === b ? a.flags |= 65536 : (a.flags |= 128, c.flags |= 131072, c.flags &= -52805, 1 === c.tag && (null === c.alternate ? c.tag = 17 : (b = mh(-1, 1), b.tag = 2, nh(c, b, 1))), c.lanes |= 1), a;
  a.flags |= 65536;
  a.lanes = e;
  return a;
}
var Wi = ua.ReactCurrentOwner, dh = false;
function Xi(a, b, c, d) {
  b.child = null === a ? Vg(b, null, c, d) : Ug(b, a.child, c, d);
}
function Yi(a, b, c, d, e) {
  c = c.render;
  var f2 = b.ref;
  ch(b, e);
  d = Nh(a, b, c, d, f2, e);
  c = Sh();
  if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
  I && c && vg(b);
  b.flags |= 1;
  Xi(a, b, d, e);
  return b.child;
}
function $i(a, b, c, d, e) {
  if (null === a) {
    var f2 = c.type;
    if ("function" === typeof f2 && !aj(f2) && void 0 === f2.defaultProps && null === c.compare && void 0 === c.defaultProps) return b.tag = 15, b.type = f2, bj(a, b, f2, d, e);
    a = Rg(c.type, null, d, b, b.mode, e);
    a.ref = b.ref;
    a.return = b;
    return b.child = a;
  }
  f2 = a.child;
  if (0 === (a.lanes & e)) {
    var g = f2.memoizedProps;
    c = c.compare;
    c = null !== c ? c : Ie;
    if (c(g, d) && a.ref === b.ref) return Zi(a, b, e);
  }
  b.flags |= 1;
  a = Pg(f2, d);
  a.ref = b.ref;
  a.return = b;
  return b.child = a;
}
function bj(a, b, c, d, e) {
  if (null !== a) {
    var f2 = a.memoizedProps;
    if (Ie(f2, d) && a.ref === b.ref) if (dh = false, b.pendingProps = d = f2, 0 !== (a.lanes & e)) 0 !== (a.flags & 131072) && (dh = true);
    else return b.lanes = a.lanes, Zi(a, b, e);
  }
  return cj(a, b, c, d, e);
}
function dj(a, b, c) {
  var d = b.pendingProps, e = d.children, f2 = null !== a ? a.memoizedState : null;
  if ("hidden" === d.mode) if (0 === (b.mode & 1)) b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, G(ej, fj), fj |= c;
  else {
    if (0 === (c & 1073741824)) return a = null !== f2 ? f2.baseLanes | c : c, b.lanes = b.childLanes = 1073741824, b.memoizedState = { baseLanes: a, cachePool: null, transitions: null }, b.updateQueue = null, G(ej, fj), fj |= a, null;
    b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null };
    d = null !== f2 ? f2.baseLanes : c;
    G(ej, fj);
    fj |= d;
  }
  else null !== f2 ? (d = f2.baseLanes | c, b.memoizedState = null) : d = c, G(ej, fj), fj |= d;
  Xi(a, b, e, c);
  return b.child;
}
function gj(a, b) {
  var c = b.ref;
  if (null === a && null !== c || null !== a && a.ref !== c) b.flags |= 512, b.flags |= 2097152;
}
function cj(a, b, c, d, e) {
  var f2 = Zf(c) ? Xf : H.current;
  f2 = Yf(b, f2);
  ch(b, e);
  c = Nh(a, b, c, d, f2, e);
  d = Sh();
  if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
  I && d && vg(b);
  b.flags |= 1;
  Xi(a, b, c, e);
  return b.child;
}
function hj(a, b, c, d, e) {
  if (Zf(c)) {
    var f2 = true;
    cg(b);
  } else f2 = false;
  ch(b, e);
  if (null === b.stateNode) ij(a, b), Gi(b, c, d), Ii(b, c, d, e), d = true;
  else if (null === a) {
    var g = b.stateNode, h = b.memoizedProps;
    g.props = h;
    var k2 = g.context, l2 = c.contextType;
    "object" === typeof l2 && null !== l2 ? l2 = eh(l2) : (l2 = Zf(c) ? Xf : H.current, l2 = Yf(b, l2));
    var m2 = c.getDerivedStateFromProps, q2 = "function" === typeof m2 || "function" === typeof g.getSnapshotBeforeUpdate;
    q2 || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== d || k2 !== l2) && Hi(b, g, d, l2);
    jh = false;
    var r2 = b.memoizedState;
    g.state = r2;
    qh(b, d, g, e);
    k2 = b.memoizedState;
    h !== d || r2 !== k2 || Wf.current || jh ? ("function" === typeof m2 && (Di(b, c, m2, d), k2 = b.memoizedState), (h = jh || Fi(b, c, h, d, r2, k2, l2)) ? (q2 || "function" !== typeof g.UNSAFE_componentWillMount && "function" !== typeof g.componentWillMount || ("function" === typeof g.componentWillMount && g.componentWillMount(), "function" === typeof g.UNSAFE_componentWillMount && g.UNSAFE_componentWillMount()), "function" === typeof g.componentDidMount && (b.flags |= 4194308)) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), b.memoizedProps = d, b.memoizedState = k2), g.props = d, g.state = k2, g.context = l2, d = h) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), d = false);
  } else {
    g = b.stateNode;
    lh(a, b);
    h = b.memoizedProps;
    l2 = b.type === b.elementType ? h : Ci(b.type, h);
    g.props = l2;
    q2 = b.pendingProps;
    r2 = g.context;
    k2 = c.contextType;
    "object" === typeof k2 && null !== k2 ? k2 = eh(k2) : (k2 = Zf(c) ? Xf : H.current, k2 = Yf(b, k2));
    var y2 = c.getDerivedStateFromProps;
    (m2 = "function" === typeof y2 || "function" === typeof g.getSnapshotBeforeUpdate) || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== q2 || r2 !== k2) && Hi(b, g, d, k2);
    jh = false;
    r2 = b.memoizedState;
    g.state = r2;
    qh(b, d, g, e);
    var n2 = b.memoizedState;
    h !== q2 || r2 !== n2 || Wf.current || jh ? ("function" === typeof y2 && (Di(b, c, y2, d), n2 = b.memoizedState), (l2 = jh || Fi(b, c, l2, d, r2, n2, k2) || false) ? (m2 || "function" !== typeof g.UNSAFE_componentWillUpdate && "function" !== typeof g.componentWillUpdate || ("function" === typeof g.componentWillUpdate && g.componentWillUpdate(d, n2, k2), "function" === typeof g.UNSAFE_componentWillUpdate && g.UNSAFE_componentWillUpdate(d, n2, k2)), "function" === typeof g.componentDidUpdate && (b.flags |= 4), "function" === typeof g.getSnapshotBeforeUpdate && (b.flags |= 1024)) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r2 === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r2 === a.memoizedState || (b.flags |= 1024), b.memoizedProps = d, b.memoizedState = n2), g.props = d, g.state = n2, g.context = k2, d = l2) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r2 === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r2 === a.memoizedState || (b.flags |= 1024), d = false);
  }
  return jj(a, b, c, d, f2, e);
}
function jj(a, b, c, d, e, f2) {
  gj(a, b);
  var g = 0 !== (b.flags & 128);
  if (!d && !g) return e && dg(b, c, false), Zi(a, b, f2);
  d = b.stateNode;
  Wi.current = b;
  var h = g && "function" !== typeof c.getDerivedStateFromError ? null : d.render();
  b.flags |= 1;
  null !== a && g ? (b.child = Ug(b, a.child, null, f2), b.child = Ug(b, null, h, f2)) : Xi(a, b, h, f2);
  b.memoizedState = d.state;
  e && dg(b, c, true);
  return b.child;
}
function kj(a) {
  var b = a.stateNode;
  b.pendingContext ? ag(a, b.pendingContext, b.pendingContext !== b.context) : b.context && ag(a, b.context, false);
  yh(a, b.containerInfo);
}
function lj(a, b, c, d, e) {
  Ig();
  Jg(e);
  b.flags |= 256;
  Xi(a, b, c, d);
  return b.child;
}
var mj = { dehydrated: null, treeContext: null, retryLane: 0 };
function nj(a) {
  return { baseLanes: a, cachePool: null, transitions: null };
}
function oj(a, b, c) {
  var d = b.pendingProps, e = L.current, f2 = false, g = 0 !== (b.flags & 128), h;
  (h = g) || (h = null !== a && null === a.memoizedState ? false : 0 !== (e & 2));
  if (h) f2 = true, b.flags &= -129;
  else if (null === a || null !== a.memoizedState) e |= 1;
  G(L, e & 1);
  if (null === a) {
    Eg(b);
    a = b.memoizedState;
    if (null !== a && (a = a.dehydrated, null !== a)) return 0 === (b.mode & 1) ? b.lanes = 1 : "$!" === a.data ? b.lanes = 8 : b.lanes = 1073741824, null;
    g = d.children;
    a = d.fallback;
    return f2 ? (d = b.mode, f2 = b.child, g = { mode: "hidden", children: g }, 0 === (d & 1) && null !== f2 ? (f2.childLanes = 0, f2.pendingProps = g) : f2 = pj(g, d, 0, null), a = Tg(a, d, c, null), f2.return = b, a.return = b, f2.sibling = a, b.child = f2, b.child.memoizedState = nj(c), b.memoizedState = mj, a) : qj(b, g);
  }
  e = a.memoizedState;
  if (null !== e && (h = e.dehydrated, null !== h)) return rj(a, b, g, d, h, e, c);
  if (f2) {
    f2 = d.fallback;
    g = b.mode;
    e = a.child;
    h = e.sibling;
    var k2 = { mode: "hidden", children: d.children };
    0 === (g & 1) && b.child !== e ? (d = b.child, d.childLanes = 0, d.pendingProps = k2, b.deletions = null) : (d = Pg(e, k2), d.subtreeFlags = e.subtreeFlags & 14680064);
    null !== h ? f2 = Pg(h, f2) : (f2 = Tg(f2, g, c, null), f2.flags |= 2);
    f2.return = b;
    d.return = b;
    d.sibling = f2;
    b.child = d;
    d = f2;
    f2 = b.child;
    g = a.child.memoizedState;
    g = null === g ? nj(c) : { baseLanes: g.baseLanes | c, cachePool: null, transitions: g.transitions };
    f2.memoizedState = g;
    f2.childLanes = a.childLanes & ~c;
    b.memoizedState = mj;
    return d;
  }
  f2 = a.child;
  a = f2.sibling;
  d = Pg(f2, { mode: "visible", children: d.children });
  0 === (b.mode & 1) && (d.lanes = c);
  d.return = b;
  d.sibling = null;
  null !== a && (c = b.deletions, null === c ? (b.deletions = [a], b.flags |= 16) : c.push(a));
  b.child = d;
  b.memoizedState = null;
  return d;
}
function qj(a, b) {
  b = pj({ mode: "visible", children: b }, a.mode, 0, null);
  b.return = a;
  return a.child = b;
}
function sj(a, b, c, d) {
  null !== d && Jg(d);
  Ug(b, a.child, null, c);
  a = qj(b, b.pendingProps.children);
  a.flags |= 2;
  b.memoizedState = null;
  return a;
}
function rj(a, b, c, d, e, f2, g) {
  if (c) {
    if (b.flags & 256) return b.flags &= -257, d = Ki(Error(p(422))), sj(a, b, g, d);
    if (null !== b.memoizedState) return b.child = a.child, b.flags |= 128, null;
    f2 = d.fallback;
    e = b.mode;
    d = pj({ mode: "visible", children: d.children }, e, 0, null);
    f2 = Tg(f2, e, g, null);
    f2.flags |= 2;
    d.return = b;
    f2.return = b;
    d.sibling = f2;
    b.child = d;
    0 !== (b.mode & 1) && Ug(b, a.child, null, g);
    b.child.memoizedState = nj(g);
    b.memoizedState = mj;
    return f2;
  }
  if (0 === (b.mode & 1)) return sj(a, b, g, null);
  if ("$!" === e.data) {
    d = e.nextSibling && e.nextSibling.dataset;
    if (d) var h = d.dgst;
    d = h;
    f2 = Error(p(419));
    d = Ki(f2, d, void 0);
    return sj(a, b, g, d);
  }
  h = 0 !== (g & a.childLanes);
  if (dh || h) {
    d = Q;
    if (null !== d) {
      switch (g & -g) {
        case 4:
          e = 2;
          break;
        case 16:
          e = 8;
          break;
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          e = 32;
          break;
        case 536870912:
          e = 268435456;
          break;
        default:
          e = 0;
      }
      e = 0 !== (e & (d.suspendedLanes | g)) ? 0 : e;
      0 !== e && e !== f2.retryLane && (f2.retryLane = e, ih(a, e), gi(d, a, e, -1));
    }
    tj();
    d = Ki(Error(p(421)));
    return sj(a, b, g, d);
  }
  if ("$?" === e.data) return b.flags |= 128, b.child = a.child, b = uj.bind(null, a), e._reactRetry = b, null;
  a = f2.treeContext;
  yg = Lf(e.nextSibling);
  xg = b;
  I = true;
  zg = null;
  null !== a && (og[pg++] = rg, og[pg++] = sg, og[pg++] = qg, rg = a.id, sg = a.overflow, qg = b);
  b = qj(b, d.children);
  b.flags |= 4096;
  return b;
}
function vj(a, b, c) {
  a.lanes |= b;
  var d = a.alternate;
  null !== d && (d.lanes |= b);
  bh(a.return, b, c);
}
function wj(a, b, c, d, e) {
  var f2 = a.memoizedState;
  null === f2 ? a.memoizedState = { isBackwards: b, rendering: null, renderingStartTime: 0, last: d, tail: c, tailMode: e } : (f2.isBackwards = b, f2.rendering = null, f2.renderingStartTime = 0, f2.last = d, f2.tail = c, f2.tailMode = e);
}
function xj(a, b, c) {
  var d = b.pendingProps, e = d.revealOrder, f2 = d.tail;
  Xi(a, b, d.children, c);
  d = L.current;
  if (0 !== (d & 2)) d = d & 1 | 2, b.flags |= 128;
  else {
    if (null !== a && 0 !== (a.flags & 128)) a: for (a = b.child; null !== a; ) {
      if (13 === a.tag) null !== a.memoizedState && vj(a, c, b);
      else if (19 === a.tag) vj(a, c, b);
      else if (null !== a.child) {
        a.child.return = a;
        a = a.child;
        continue;
      }
      if (a === b) break a;
      for (; null === a.sibling; ) {
        if (null === a.return || a.return === b) break a;
        a = a.return;
      }
      a.sibling.return = a.return;
      a = a.sibling;
    }
    d &= 1;
  }
  G(L, d);
  if (0 === (b.mode & 1)) b.memoizedState = null;
  else switch (e) {
    case "forwards":
      c = b.child;
      for (e = null; null !== c; ) a = c.alternate, null !== a && null === Ch(a) && (e = c), c = c.sibling;
      c = e;
      null === c ? (e = b.child, b.child = null) : (e = c.sibling, c.sibling = null);
      wj(b, false, e, c, f2);
      break;
    case "backwards":
      c = null;
      e = b.child;
      for (b.child = null; null !== e; ) {
        a = e.alternate;
        if (null !== a && null === Ch(a)) {
          b.child = e;
          break;
        }
        a = e.sibling;
        e.sibling = c;
        c = e;
        e = a;
      }
      wj(b, true, c, null, f2);
      break;
    case "together":
      wj(b, false, null, null, void 0);
      break;
    default:
      b.memoizedState = null;
  }
  return b.child;
}
function ij(a, b) {
  0 === (b.mode & 1) && null !== a && (a.alternate = null, b.alternate = null, b.flags |= 2);
}
function Zi(a, b, c) {
  null !== a && (b.dependencies = a.dependencies);
  rh |= b.lanes;
  if (0 === (c & b.childLanes)) return null;
  if (null !== a && b.child !== a.child) throw Error(p(153));
  if (null !== b.child) {
    a = b.child;
    c = Pg(a, a.pendingProps);
    b.child = c;
    for (c.return = b; null !== a.sibling; ) a = a.sibling, c = c.sibling = Pg(a, a.pendingProps), c.return = b;
    c.sibling = null;
  }
  return b.child;
}
function yj(a, b, c) {
  switch (b.tag) {
    case 3:
      kj(b);
      Ig();
      break;
    case 5:
      Ah(b);
      break;
    case 1:
      Zf(b.type) && cg(b);
      break;
    case 4:
      yh(b, b.stateNode.containerInfo);
      break;
    case 10:
      var d = b.type._context, e = b.memoizedProps.value;
      G(Wg, d._currentValue);
      d._currentValue = e;
      break;
    case 13:
      d = b.memoizedState;
      if (null !== d) {
        if (null !== d.dehydrated) return G(L, L.current & 1), b.flags |= 128, null;
        if (0 !== (c & b.child.childLanes)) return oj(a, b, c);
        G(L, L.current & 1);
        a = Zi(a, b, c);
        return null !== a ? a.sibling : null;
      }
      G(L, L.current & 1);
      break;
    case 19:
      d = 0 !== (c & b.childLanes);
      if (0 !== (a.flags & 128)) {
        if (d) return xj(a, b, c);
        b.flags |= 128;
      }
      e = b.memoizedState;
      null !== e && (e.rendering = null, e.tail = null, e.lastEffect = null);
      G(L, L.current);
      if (d) break;
      else return null;
    case 22:
    case 23:
      return b.lanes = 0, dj(a, b, c);
  }
  return Zi(a, b, c);
}
var zj, Aj, Bj, Cj;
zj = function(a, b) {
  for (var c = b.child; null !== c; ) {
    if (5 === c.tag || 6 === c.tag) a.appendChild(c.stateNode);
    else if (4 !== c.tag && null !== c.child) {
      c.child.return = c;
      c = c.child;
      continue;
    }
    if (c === b) break;
    for (; null === c.sibling; ) {
      if (null === c.return || c.return === b) return;
      c = c.return;
    }
    c.sibling.return = c.return;
    c = c.sibling;
  }
};
Aj = function() {
};
Bj = function(a, b, c, d) {
  var e = a.memoizedProps;
  if (e !== d) {
    a = b.stateNode;
    xh(uh.current);
    var f2 = null;
    switch (c) {
      case "input":
        e = Ya(a, e);
        d = Ya(a, d);
        f2 = [];
        break;
      case "select":
        e = A({}, e, { value: void 0 });
        d = A({}, d, { value: void 0 });
        f2 = [];
        break;
      case "textarea":
        e = gb(a, e);
        d = gb(a, d);
        f2 = [];
        break;
      default:
        "function" !== typeof e.onClick && "function" === typeof d.onClick && (a.onclick = Bf);
    }
    ub(c, d);
    var g;
    c = null;
    for (l2 in e) if (!d.hasOwnProperty(l2) && e.hasOwnProperty(l2) && null != e[l2]) if ("style" === l2) {
      var h = e[l2];
      for (g in h) h.hasOwnProperty(g) && (c || (c = {}), c[g] = "");
    } else "dangerouslySetInnerHTML" !== l2 && "children" !== l2 && "suppressContentEditableWarning" !== l2 && "suppressHydrationWarning" !== l2 && "autoFocus" !== l2 && (ea.hasOwnProperty(l2) ? f2 || (f2 = []) : (f2 = f2 || []).push(l2, null));
    for (l2 in d) {
      var k2 = d[l2];
      h = null != e ? e[l2] : void 0;
      if (d.hasOwnProperty(l2) && k2 !== h && (null != k2 || null != h)) if ("style" === l2) if (h) {
        for (g in h) !h.hasOwnProperty(g) || k2 && k2.hasOwnProperty(g) || (c || (c = {}), c[g] = "");
        for (g in k2) k2.hasOwnProperty(g) && h[g] !== k2[g] && (c || (c = {}), c[g] = k2[g]);
      } else c || (f2 || (f2 = []), f2.push(
        l2,
        c
      )), c = k2;
      else "dangerouslySetInnerHTML" === l2 ? (k2 = k2 ? k2.__html : void 0, h = h ? h.__html : void 0, null != k2 && h !== k2 && (f2 = f2 || []).push(l2, k2)) : "children" === l2 ? "string" !== typeof k2 && "number" !== typeof k2 || (f2 = f2 || []).push(l2, "" + k2) : "suppressContentEditableWarning" !== l2 && "suppressHydrationWarning" !== l2 && (ea.hasOwnProperty(l2) ? (null != k2 && "onScroll" === l2 && D("scroll", a), f2 || h === k2 || (f2 = [])) : (f2 = f2 || []).push(l2, k2));
    }
    c && (f2 = f2 || []).push("style", c);
    var l2 = f2;
    if (b.updateQueue = l2) b.flags |= 4;
  }
};
Cj = function(a, b, c, d) {
  c !== d && (b.flags |= 4);
};
function Dj(a, b) {
  if (!I) switch (a.tailMode) {
    case "hidden":
      b = a.tail;
      for (var c = null; null !== b; ) null !== b.alternate && (c = b), b = b.sibling;
      null === c ? a.tail = null : c.sibling = null;
      break;
    case "collapsed":
      c = a.tail;
      for (var d = null; null !== c; ) null !== c.alternate && (d = c), c = c.sibling;
      null === d ? b || null === a.tail ? a.tail = null : a.tail.sibling = null : d.sibling = null;
  }
}
function S(a) {
  var b = null !== a.alternate && a.alternate.child === a.child, c = 0, d = 0;
  if (b) for (var e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags & 14680064, d |= e.flags & 14680064, e.return = a, e = e.sibling;
  else for (e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags, d |= e.flags, e.return = a, e = e.sibling;
  a.subtreeFlags |= d;
  a.childLanes = c;
  return b;
}
function Ej(a, b, c) {
  var d = b.pendingProps;
  wg(b);
  switch (b.tag) {
    case 2:
    case 16:
    case 15:
    case 0:
    case 11:
    case 7:
    case 8:
    case 12:
    case 9:
    case 14:
      return S(b), null;
    case 1:
      return Zf(b.type) && $f(), S(b), null;
    case 3:
      d = b.stateNode;
      zh();
      E(Wf);
      E(H);
      Eh();
      d.pendingContext && (d.context = d.pendingContext, d.pendingContext = null);
      if (null === a || null === a.child) Gg(b) ? b.flags |= 4 : null === a || a.memoizedState.isDehydrated && 0 === (b.flags & 256) || (b.flags |= 1024, null !== zg && (Fj(zg), zg = null));
      Aj(a, b);
      S(b);
      return null;
    case 5:
      Bh(b);
      var e = xh(wh.current);
      c = b.type;
      if (null !== a && null != b.stateNode) Bj(a, b, c, d, e), a.ref !== b.ref && (b.flags |= 512, b.flags |= 2097152);
      else {
        if (!d) {
          if (null === b.stateNode) throw Error(p(166));
          S(b);
          return null;
        }
        a = xh(uh.current);
        if (Gg(b)) {
          d = b.stateNode;
          c = b.type;
          var f2 = b.memoizedProps;
          d[Of] = b;
          d[Pf] = f2;
          a = 0 !== (b.mode & 1);
          switch (c) {
            case "dialog":
              D("cancel", d);
              D("close", d);
              break;
            case "iframe":
            case "object":
            case "embed":
              D("load", d);
              break;
            case "video":
            case "audio":
              for (e = 0; e < lf.length; e++) D(lf[e], d);
              break;
            case "source":
              D("error", d);
              break;
            case "img":
            case "image":
            case "link":
              D(
                "error",
                d
              );
              D("load", d);
              break;
            case "details":
              D("toggle", d);
              break;
            case "input":
              Za(d, f2);
              D("invalid", d);
              break;
            case "select":
              d._wrapperState = { wasMultiple: !!f2.multiple };
              D("invalid", d);
              break;
            case "textarea":
              hb(d, f2), D("invalid", d);
          }
          ub(c, f2);
          e = null;
          for (var g in f2) if (f2.hasOwnProperty(g)) {
            var h = f2[g];
            "children" === g ? "string" === typeof h ? d.textContent !== h && (true !== f2.suppressHydrationWarning && Af(d.textContent, h, a), e = ["children", h]) : "number" === typeof h && d.textContent !== "" + h && (true !== f2.suppressHydrationWarning && Af(
              d.textContent,
              h,
              a
            ), e = ["children", "" + h]) : ea.hasOwnProperty(g) && null != h && "onScroll" === g && D("scroll", d);
          }
          switch (c) {
            case "input":
              Va(d);
              db(d, f2, true);
              break;
            case "textarea":
              Va(d);
              jb(d);
              break;
            case "select":
            case "option":
              break;
            default:
              "function" === typeof f2.onClick && (d.onclick = Bf);
          }
          d = e;
          b.updateQueue = d;
          null !== d && (b.flags |= 4);
        } else {
          g = 9 === e.nodeType ? e : e.ownerDocument;
          "http://www.w3.org/1999/xhtml" === a && (a = kb(c));
          "http://www.w3.org/1999/xhtml" === a ? "script" === c ? (a = g.createElement("div"), a.innerHTML = "<script><\/script>", a = a.removeChild(a.firstChild)) : "string" === typeof d.is ? a = g.createElement(c, { is: d.is }) : (a = g.createElement(c), "select" === c && (g = a, d.multiple ? g.multiple = true : d.size && (g.size = d.size))) : a = g.createElementNS(a, c);
          a[Of] = b;
          a[Pf] = d;
          zj(a, b, false, false);
          b.stateNode = a;
          a: {
            g = vb(c, d);
            switch (c) {
              case "dialog":
                D("cancel", a);
                D("close", a);
                e = d;
                break;
              case "iframe":
              case "object":
              case "embed":
                D("load", a);
                e = d;
                break;
              case "video":
              case "audio":
                for (e = 0; e < lf.length; e++) D(lf[e], a);
                e = d;
                break;
              case "source":
                D("error", a);
                e = d;
                break;
              case "img":
              case "image":
              case "link":
                D(
                  "error",
                  a
                );
                D("load", a);
                e = d;
                break;
              case "details":
                D("toggle", a);
                e = d;
                break;
              case "input":
                Za(a, d);
                e = Ya(a, d);
                D("invalid", a);
                break;
              case "option":
                e = d;
                break;
              case "select":
                a._wrapperState = { wasMultiple: !!d.multiple };
                e = A({}, d, { value: void 0 });
                D("invalid", a);
                break;
              case "textarea":
                hb(a, d);
                e = gb(a, d);
                D("invalid", a);
                break;
              default:
                e = d;
            }
            ub(c, e);
            h = e;
            for (f2 in h) if (h.hasOwnProperty(f2)) {
              var k2 = h[f2];
              "style" === f2 ? sb(a, k2) : "dangerouslySetInnerHTML" === f2 ? (k2 = k2 ? k2.__html : void 0, null != k2 && nb(a, k2)) : "children" === f2 ? "string" === typeof k2 ? ("textarea" !== c || "" !== k2) && ob(a, k2) : "number" === typeof k2 && ob(a, "" + k2) : "suppressContentEditableWarning" !== f2 && "suppressHydrationWarning" !== f2 && "autoFocus" !== f2 && (ea.hasOwnProperty(f2) ? null != k2 && "onScroll" === f2 && D("scroll", a) : null != k2 && ta(a, f2, k2, g));
            }
            switch (c) {
              case "input":
                Va(a);
                db(a, d, false);
                break;
              case "textarea":
                Va(a);
                jb(a);
                break;
              case "option":
                null != d.value && a.setAttribute("value", "" + Sa(d.value));
                break;
              case "select":
                a.multiple = !!d.multiple;
                f2 = d.value;
                null != f2 ? fb(a, !!d.multiple, f2, false) : null != d.defaultValue && fb(
                  a,
                  !!d.multiple,
                  d.defaultValue,
                  true
                );
                break;
              default:
                "function" === typeof e.onClick && (a.onclick = Bf);
            }
            switch (c) {
              case "button":
              case "input":
              case "select":
              case "textarea":
                d = !!d.autoFocus;
                break a;
              case "img":
                d = true;
                break a;
              default:
                d = false;
            }
          }
          d && (b.flags |= 4);
        }
        null !== b.ref && (b.flags |= 512, b.flags |= 2097152);
      }
      S(b);
      return null;
    case 6:
      if (a && null != b.stateNode) Cj(a, b, a.memoizedProps, d);
      else {
        if ("string" !== typeof d && null === b.stateNode) throw Error(p(166));
        c = xh(wh.current);
        xh(uh.current);
        if (Gg(b)) {
          d = b.stateNode;
          c = b.memoizedProps;
          d[Of] = b;
          if (f2 = d.nodeValue !== c) {
            if (a = xg, null !== a) switch (a.tag) {
              case 3:
                Af(d.nodeValue, c, 0 !== (a.mode & 1));
                break;
              case 5:
                true !== a.memoizedProps.suppressHydrationWarning && Af(d.nodeValue, c, 0 !== (a.mode & 1));
            }
          }
          f2 && (b.flags |= 4);
        } else d = (9 === c.nodeType ? c : c.ownerDocument).createTextNode(d), d[Of] = b, b.stateNode = d;
      }
      S(b);
      return null;
    case 13:
      E(L);
      d = b.memoizedState;
      if (null === a || null !== a.memoizedState && null !== a.memoizedState.dehydrated) {
        if (I && null !== yg && 0 !== (b.mode & 1) && 0 === (b.flags & 128)) Hg(), Ig(), b.flags |= 98560, f2 = false;
        else if (f2 = Gg(b), null !== d && null !== d.dehydrated) {
          if (null === a) {
            if (!f2) throw Error(p(318));
            f2 = b.memoizedState;
            f2 = null !== f2 ? f2.dehydrated : null;
            if (!f2) throw Error(p(317));
            f2[Of] = b;
          } else Ig(), 0 === (b.flags & 128) && (b.memoizedState = null), b.flags |= 4;
          S(b);
          f2 = false;
        } else null !== zg && (Fj(zg), zg = null), f2 = true;
        if (!f2) return b.flags & 65536 ? b : null;
      }
      if (0 !== (b.flags & 128)) return b.lanes = c, b;
      d = null !== d;
      d !== (null !== a && null !== a.memoizedState) && d && (b.child.flags |= 8192, 0 !== (b.mode & 1) && (null === a || 0 !== (L.current & 1) ? 0 === T && (T = 3) : tj()));
      null !== b.updateQueue && (b.flags |= 4);
      S(b);
      return null;
    case 4:
      return zh(), Aj(a, b), null === a && sf(b.stateNode.containerInfo), S(b), null;
    case 10:
      return ah(b.type._context), S(b), null;
    case 17:
      return Zf(b.type) && $f(), S(b), null;
    case 19:
      E(L);
      f2 = b.memoizedState;
      if (null === f2) return S(b), null;
      d = 0 !== (b.flags & 128);
      g = f2.rendering;
      if (null === g) if (d) Dj(f2, false);
      else {
        if (0 !== T || null !== a && 0 !== (a.flags & 128)) for (a = b.child; null !== a; ) {
          g = Ch(a);
          if (null !== g) {
            b.flags |= 128;
            Dj(f2, false);
            d = g.updateQueue;
            null !== d && (b.updateQueue = d, b.flags |= 4);
            b.subtreeFlags = 0;
            d = c;
            for (c = b.child; null !== c; ) f2 = c, a = d, f2.flags &= 14680066, g = f2.alternate, null === g ? (f2.childLanes = 0, f2.lanes = a, f2.child = null, f2.subtreeFlags = 0, f2.memoizedProps = null, f2.memoizedState = null, f2.updateQueue = null, f2.dependencies = null, f2.stateNode = null) : (f2.childLanes = g.childLanes, f2.lanes = g.lanes, f2.child = g.child, f2.subtreeFlags = 0, f2.deletions = null, f2.memoizedProps = g.memoizedProps, f2.memoizedState = g.memoizedState, f2.updateQueue = g.updateQueue, f2.type = g.type, a = g.dependencies, f2.dependencies = null === a ? null : { lanes: a.lanes, firstContext: a.firstContext }), c = c.sibling;
            G(L, L.current & 1 | 2);
            return b.child;
          }
          a = a.sibling;
        }
        null !== f2.tail && B() > Gj && (b.flags |= 128, d = true, Dj(f2, false), b.lanes = 4194304);
      }
      else {
        if (!d) if (a = Ch(g), null !== a) {
          if (b.flags |= 128, d = true, c = a.updateQueue, null !== c && (b.updateQueue = c, b.flags |= 4), Dj(f2, true), null === f2.tail && "hidden" === f2.tailMode && !g.alternate && !I) return S(b), null;
        } else 2 * B() - f2.renderingStartTime > Gj && 1073741824 !== c && (b.flags |= 128, d = true, Dj(f2, false), b.lanes = 4194304);
        f2.isBackwards ? (g.sibling = b.child, b.child = g) : (c = f2.last, null !== c ? c.sibling = g : b.child = g, f2.last = g);
      }
      if (null !== f2.tail) return b = f2.tail, f2.rendering = b, f2.tail = b.sibling, f2.renderingStartTime = B(), b.sibling = null, c = L.current, G(L, d ? c & 1 | 2 : c & 1), b;
      S(b);
      return null;
    case 22:
    case 23:
      return Hj(), d = null !== b.memoizedState, null !== a && null !== a.memoizedState !== d && (b.flags |= 8192), d && 0 !== (b.mode & 1) ? 0 !== (fj & 1073741824) && (S(b), b.subtreeFlags & 6 && (b.flags |= 8192)) : S(b), null;
    case 24:
      return null;
    case 25:
      return null;
  }
  throw Error(p(156, b.tag));
}
function Ij(a, b) {
  wg(b);
  switch (b.tag) {
    case 1:
      return Zf(b.type) && $f(), a = b.flags, a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
    case 3:
      return zh(), E(Wf), E(H), Eh(), a = b.flags, 0 !== (a & 65536) && 0 === (a & 128) ? (b.flags = a & -65537 | 128, b) : null;
    case 5:
      return Bh(b), null;
    case 13:
      E(L);
      a = b.memoizedState;
      if (null !== a && null !== a.dehydrated) {
        if (null === b.alternate) throw Error(p(340));
        Ig();
      }
      a = b.flags;
      return a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
    case 19:
      return E(L), null;
    case 4:
      return zh(), null;
    case 10:
      return ah(b.type._context), null;
    case 22:
    case 23:
      return Hj(), null;
    case 24:
      return null;
    default:
      return null;
  }
}
var Jj = false, U = false, Kj = "function" === typeof WeakSet ? WeakSet : Set, V = null;
function Lj(a, b) {
  var c = a.ref;
  if (null !== c) if ("function" === typeof c) try {
    c(null);
  } catch (d) {
    W(a, b, d);
  }
  else c.current = null;
}
function Mj(a, b, c) {
  try {
    c();
  } catch (d) {
    W(a, b, d);
  }
}
var Nj = false;
function Oj(a, b) {
  Cf = dd;
  a = Me();
  if (Ne(a)) {
    if ("selectionStart" in a) var c = { start: a.selectionStart, end: a.selectionEnd };
    else a: {
      c = (c = a.ownerDocument) && c.defaultView || window;
      var d = c.getSelection && c.getSelection();
      if (d && 0 !== d.rangeCount) {
        c = d.anchorNode;
        var e = d.anchorOffset, f2 = d.focusNode;
        d = d.focusOffset;
        try {
          c.nodeType, f2.nodeType;
        } catch (F2) {
          c = null;
          break a;
        }
        var g = 0, h = -1, k2 = -1, l2 = 0, m2 = 0, q2 = a, r2 = null;
        b: for (; ; ) {
          for (var y2; ; ) {
            q2 !== c || 0 !== e && 3 !== q2.nodeType || (h = g + e);
            q2 !== f2 || 0 !== d && 3 !== q2.nodeType || (k2 = g + d);
            3 === q2.nodeType && (g += q2.nodeValue.length);
            if (null === (y2 = q2.firstChild)) break;
            r2 = q2;
            q2 = y2;
          }
          for (; ; ) {
            if (q2 === a) break b;
            r2 === c && ++l2 === e && (h = g);
            r2 === f2 && ++m2 === d && (k2 = g);
            if (null !== (y2 = q2.nextSibling)) break;
            q2 = r2;
            r2 = q2.parentNode;
          }
          q2 = y2;
        }
        c = -1 === h || -1 === k2 ? null : { start: h, end: k2 };
      } else c = null;
    }
    c = c || { start: 0, end: 0 };
  } else c = null;
  Df = { focusedElem: a, selectionRange: c };
  dd = false;
  for (V = b; null !== V; ) if (b = V, a = b.child, 0 !== (b.subtreeFlags & 1028) && null !== a) a.return = b, V = a;
  else for (; null !== V; ) {
    b = V;
    try {
      var n2 = b.alternate;
      if (0 !== (b.flags & 1024)) switch (b.tag) {
        case 0:
        case 11:
        case 15:
          break;
        case 1:
          if (null !== n2) {
            var t2 = n2.memoizedProps, J2 = n2.memoizedState, x2 = b.stateNode, w2 = x2.getSnapshotBeforeUpdate(b.elementType === b.type ? t2 : Ci(b.type, t2), J2);
            x2.__reactInternalSnapshotBeforeUpdate = w2;
          }
          break;
        case 3:
          var u2 = b.stateNode.containerInfo;
          1 === u2.nodeType ? u2.textContent = "" : 9 === u2.nodeType && u2.documentElement && u2.removeChild(u2.documentElement);
          break;
        case 5:
        case 6:
        case 4:
        case 17:
          break;
        default:
          throw Error(p(163));
      }
    } catch (F2) {
      W(b, b.return, F2);
    }
    a = b.sibling;
    if (null !== a) {
      a.return = b.return;
      V = a;
      break;
    }
    V = b.return;
  }
  n2 = Nj;
  Nj = false;
  return n2;
}
function Pj(a, b, c) {
  var d = b.updateQueue;
  d = null !== d ? d.lastEffect : null;
  if (null !== d) {
    var e = d = d.next;
    do {
      if ((e.tag & a) === a) {
        var f2 = e.destroy;
        e.destroy = void 0;
        void 0 !== f2 && Mj(b, c, f2);
      }
      e = e.next;
    } while (e !== d);
  }
}
function Qj(a, b) {
  b = b.updateQueue;
  b = null !== b ? b.lastEffect : null;
  if (null !== b) {
    var c = b = b.next;
    do {
      if ((c.tag & a) === a) {
        var d = c.create;
        c.destroy = d();
      }
      c = c.next;
    } while (c !== b);
  }
}
function Rj(a) {
  var b = a.ref;
  if (null !== b) {
    var c = a.stateNode;
    switch (a.tag) {
      case 5:
        a = c;
        break;
      default:
        a = c;
    }
    "function" === typeof b ? b(a) : b.current = a;
  }
}
function Sj(a) {
  var b = a.alternate;
  null !== b && (a.alternate = null, Sj(b));
  a.child = null;
  a.deletions = null;
  a.sibling = null;
  5 === a.tag && (b = a.stateNode, null !== b && (delete b[Of], delete b[Pf], delete b[of], delete b[Qf], delete b[Rf]));
  a.stateNode = null;
  a.return = null;
  a.dependencies = null;
  a.memoizedProps = null;
  a.memoizedState = null;
  a.pendingProps = null;
  a.stateNode = null;
  a.updateQueue = null;
}
function Tj(a) {
  return 5 === a.tag || 3 === a.tag || 4 === a.tag;
}
function Uj(a) {
  a: for (; ; ) {
    for (; null === a.sibling; ) {
      if (null === a.return || Tj(a.return)) return null;
      a = a.return;
    }
    a.sibling.return = a.return;
    for (a = a.sibling; 5 !== a.tag && 6 !== a.tag && 18 !== a.tag; ) {
      if (a.flags & 2) continue a;
      if (null === a.child || 4 === a.tag) continue a;
      else a.child.return = a, a = a.child;
    }
    if (!(a.flags & 2)) return a.stateNode;
  }
}
function Vj(a, b, c) {
  var d = a.tag;
  if (5 === d || 6 === d) a = a.stateNode, b ? 8 === c.nodeType ? c.parentNode.insertBefore(a, b) : c.insertBefore(a, b) : (8 === c.nodeType ? (b = c.parentNode, b.insertBefore(a, c)) : (b = c, b.appendChild(a)), c = c._reactRootContainer, null !== c && void 0 !== c || null !== b.onclick || (b.onclick = Bf));
  else if (4 !== d && (a = a.child, null !== a)) for (Vj(a, b, c), a = a.sibling; null !== a; ) Vj(a, b, c), a = a.sibling;
}
function Wj(a, b, c) {
  var d = a.tag;
  if (5 === d || 6 === d) a = a.stateNode, b ? c.insertBefore(a, b) : c.appendChild(a);
  else if (4 !== d && (a = a.child, null !== a)) for (Wj(a, b, c), a = a.sibling; null !== a; ) Wj(a, b, c), a = a.sibling;
}
var X$1 = null, Xj = false;
function Yj(a, b, c) {
  for (c = c.child; null !== c; ) Zj(a, b, c), c = c.sibling;
}
function Zj(a, b, c) {
  if (lc && "function" === typeof lc.onCommitFiberUnmount) try {
    lc.onCommitFiberUnmount(kc, c);
  } catch (h) {
  }
  switch (c.tag) {
    case 5:
      U || Lj(c, b);
    case 6:
      var d = X$1, e = Xj;
      X$1 = null;
      Yj(a, b, c);
      X$1 = d;
      Xj = e;
      null !== X$1 && (Xj ? (a = X$1, c = c.stateNode, 8 === a.nodeType ? a.parentNode.removeChild(c) : a.removeChild(c)) : X$1.removeChild(c.stateNode));
      break;
    case 18:
      null !== X$1 && (Xj ? (a = X$1, c = c.stateNode, 8 === a.nodeType ? Kf(a.parentNode, c) : 1 === a.nodeType && Kf(a, c), bd(a)) : Kf(X$1, c.stateNode));
      break;
    case 4:
      d = X$1;
      e = Xj;
      X$1 = c.stateNode.containerInfo;
      Xj = true;
      Yj(a, b, c);
      X$1 = d;
      Xj = e;
      break;
    case 0:
    case 11:
    case 14:
    case 15:
      if (!U && (d = c.updateQueue, null !== d && (d = d.lastEffect, null !== d))) {
        e = d = d.next;
        do {
          var f2 = e, g = f2.destroy;
          f2 = f2.tag;
          void 0 !== g && (0 !== (f2 & 2) ? Mj(c, b, g) : 0 !== (f2 & 4) && Mj(c, b, g));
          e = e.next;
        } while (e !== d);
      }
      Yj(a, b, c);
      break;
    case 1:
      if (!U && (Lj(c, b), d = c.stateNode, "function" === typeof d.componentWillUnmount)) try {
        d.props = c.memoizedProps, d.state = c.memoizedState, d.componentWillUnmount();
      } catch (h) {
        W(c, b, h);
      }
      Yj(a, b, c);
      break;
    case 21:
      Yj(a, b, c);
      break;
    case 22:
      c.mode & 1 ? (U = (d = U) || null !== c.memoizedState, Yj(a, b, c), U = d) : Yj(a, b, c);
      break;
    default:
      Yj(a, b, c);
  }
}
function ak(a) {
  var b = a.updateQueue;
  if (null !== b) {
    a.updateQueue = null;
    var c = a.stateNode;
    null === c && (c = a.stateNode = new Kj());
    b.forEach(function(b2) {
      var d = bk.bind(null, a, b2);
      c.has(b2) || (c.add(b2), b2.then(d, d));
    });
  }
}
function ck(a, b) {
  var c = b.deletions;
  if (null !== c) for (var d = 0; d < c.length; d++) {
    var e = c[d];
    try {
      var f2 = a, g = b, h = g;
      a: for (; null !== h; ) {
        switch (h.tag) {
          case 5:
            X$1 = h.stateNode;
            Xj = false;
            break a;
          case 3:
            X$1 = h.stateNode.containerInfo;
            Xj = true;
            break a;
          case 4:
            X$1 = h.stateNode.containerInfo;
            Xj = true;
            break a;
        }
        h = h.return;
      }
      if (null === X$1) throw Error(p(160));
      Zj(f2, g, e);
      X$1 = null;
      Xj = false;
      var k2 = e.alternate;
      null !== k2 && (k2.return = null);
      e.return = null;
    } catch (l2) {
      W(e, b, l2);
    }
  }
  if (b.subtreeFlags & 12854) for (b = b.child; null !== b; ) dk(b, a), b = b.sibling;
}
function dk(a, b) {
  var c = a.alternate, d = a.flags;
  switch (a.tag) {
    case 0:
    case 11:
    case 14:
    case 15:
      ck(b, a);
      ek(a);
      if (d & 4) {
        try {
          Pj(3, a, a.return), Qj(3, a);
        } catch (t2) {
          W(a, a.return, t2);
        }
        try {
          Pj(5, a, a.return);
        } catch (t2) {
          W(a, a.return, t2);
        }
      }
      break;
    case 1:
      ck(b, a);
      ek(a);
      d & 512 && null !== c && Lj(c, c.return);
      break;
    case 5:
      ck(b, a);
      ek(a);
      d & 512 && null !== c && Lj(c, c.return);
      if (a.flags & 32) {
        var e = a.stateNode;
        try {
          ob(e, "");
        } catch (t2) {
          W(a, a.return, t2);
        }
      }
      if (d & 4 && (e = a.stateNode, null != e)) {
        var f2 = a.memoizedProps, g = null !== c ? c.memoizedProps : f2, h = a.type, k2 = a.updateQueue;
        a.updateQueue = null;
        if (null !== k2) try {
          "input" === h && "radio" === f2.type && null != f2.name && ab(e, f2);
          vb(h, g);
          var l2 = vb(h, f2);
          for (g = 0; g < k2.length; g += 2) {
            var m2 = k2[g], q2 = k2[g + 1];
            "style" === m2 ? sb(e, q2) : "dangerouslySetInnerHTML" === m2 ? nb(e, q2) : "children" === m2 ? ob(e, q2) : ta(e, m2, q2, l2);
          }
          switch (h) {
            case "input":
              bb(e, f2);
              break;
            case "textarea":
              ib(e, f2);
              break;
            case "select":
              var r2 = e._wrapperState.wasMultiple;
              e._wrapperState.wasMultiple = !!f2.multiple;
              var y2 = f2.value;
              null != y2 ? fb(e, !!f2.multiple, y2, false) : r2 !== !!f2.multiple && (null != f2.defaultValue ? fb(
                e,
                !!f2.multiple,
                f2.defaultValue,
                true
              ) : fb(e, !!f2.multiple, f2.multiple ? [] : "", false));
          }
          e[Pf] = f2;
        } catch (t2) {
          W(a, a.return, t2);
        }
      }
      break;
    case 6:
      ck(b, a);
      ek(a);
      if (d & 4) {
        if (null === a.stateNode) throw Error(p(162));
        e = a.stateNode;
        f2 = a.memoizedProps;
        try {
          e.nodeValue = f2;
        } catch (t2) {
          W(a, a.return, t2);
        }
      }
      break;
    case 3:
      ck(b, a);
      ek(a);
      if (d & 4 && null !== c && c.memoizedState.isDehydrated) try {
        bd(b.containerInfo);
      } catch (t2) {
        W(a, a.return, t2);
      }
      break;
    case 4:
      ck(b, a);
      ek(a);
      break;
    case 13:
      ck(b, a);
      ek(a);
      e = a.child;
      e.flags & 8192 && (f2 = null !== e.memoizedState, e.stateNode.isHidden = f2, !f2 || null !== e.alternate && null !== e.alternate.memoizedState || (fk = B()));
      d & 4 && ak(a);
      break;
    case 22:
      m2 = null !== c && null !== c.memoizedState;
      a.mode & 1 ? (U = (l2 = U) || m2, ck(b, a), U = l2) : ck(b, a);
      ek(a);
      if (d & 8192) {
        l2 = null !== a.memoizedState;
        if ((a.stateNode.isHidden = l2) && !m2 && 0 !== (a.mode & 1)) for (V = a, m2 = a.child; null !== m2; ) {
          for (q2 = V = m2; null !== V; ) {
            r2 = V;
            y2 = r2.child;
            switch (r2.tag) {
              case 0:
              case 11:
              case 14:
              case 15:
                Pj(4, r2, r2.return);
                break;
              case 1:
                Lj(r2, r2.return);
                var n2 = r2.stateNode;
                if ("function" === typeof n2.componentWillUnmount) {
                  d = r2;
                  c = r2.return;
                  try {
                    b = d, n2.props = b.memoizedProps, n2.state = b.memoizedState, n2.componentWillUnmount();
                  } catch (t2) {
                    W(d, c, t2);
                  }
                }
                break;
              case 5:
                Lj(r2, r2.return);
                break;
              case 22:
                if (null !== r2.memoizedState) {
                  gk(q2);
                  continue;
                }
            }
            null !== y2 ? (y2.return = r2, V = y2) : gk(q2);
          }
          m2 = m2.sibling;
        }
        a: for (m2 = null, q2 = a; ; ) {
          if (5 === q2.tag) {
            if (null === m2) {
              m2 = q2;
              try {
                e = q2.stateNode, l2 ? (f2 = e.style, "function" === typeof f2.setProperty ? f2.setProperty("display", "none", "important") : f2.display = "none") : (h = q2.stateNode, k2 = q2.memoizedProps.style, g = void 0 !== k2 && null !== k2 && k2.hasOwnProperty("display") ? k2.display : null, h.style.display = rb("display", g));
              } catch (t2) {
                W(a, a.return, t2);
              }
            }
          } else if (6 === q2.tag) {
            if (null === m2) try {
              q2.stateNode.nodeValue = l2 ? "" : q2.memoizedProps;
            } catch (t2) {
              W(a, a.return, t2);
            }
          } else if ((22 !== q2.tag && 23 !== q2.tag || null === q2.memoizedState || q2 === a) && null !== q2.child) {
            q2.child.return = q2;
            q2 = q2.child;
            continue;
          }
          if (q2 === a) break a;
          for (; null === q2.sibling; ) {
            if (null === q2.return || q2.return === a) break a;
            m2 === q2 && (m2 = null);
            q2 = q2.return;
          }
          m2 === q2 && (m2 = null);
          q2.sibling.return = q2.return;
          q2 = q2.sibling;
        }
      }
      break;
    case 19:
      ck(b, a);
      ek(a);
      d & 4 && ak(a);
      break;
    case 21:
      break;
    default:
      ck(
        b,
        a
      ), ek(a);
  }
}
function ek(a) {
  var b = a.flags;
  if (b & 2) {
    try {
      a: {
        for (var c = a.return; null !== c; ) {
          if (Tj(c)) {
            var d = c;
            break a;
          }
          c = c.return;
        }
        throw Error(p(160));
      }
      switch (d.tag) {
        case 5:
          var e = d.stateNode;
          d.flags & 32 && (ob(e, ""), d.flags &= -33);
          var f2 = Uj(a);
          Wj(a, f2, e);
          break;
        case 3:
        case 4:
          var g = d.stateNode.containerInfo, h = Uj(a);
          Vj(a, h, g);
          break;
        default:
          throw Error(p(161));
      }
    } catch (k2) {
      W(a, a.return, k2);
    }
    a.flags &= -3;
  }
  b & 4096 && (a.flags &= -4097);
}
function hk(a, b, c) {
  V = a;
  ik(a);
}
function ik(a, b, c) {
  for (var d = 0 !== (a.mode & 1); null !== V; ) {
    var e = V, f2 = e.child;
    if (22 === e.tag && d) {
      var g = null !== e.memoizedState || Jj;
      if (!g) {
        var h = e.alternate, k2 = null !== h && null !== h.memoizedState || U;
        h = Jj;
        var l2 = U;
        Jj = g;
        if ((U = k2) && !l2) for (V = e; null !== V; ) g = V, k2 = g.child, 22 === g.tag && null !== g.memoizedState ? jk(e) : null !== k2 ? (k2.return = g, V = k2) : jk(e);
        for (; null !== f2; ) V = f2, ik(f2), f2 = f2.sibling;
        V = e;
        Jj = h;
        U = l2;
      }
      kk(a);
    } else 0 !== (e.subtreeFlags & 8772) && null !== f2 ? (f2.return = e, V = f2) : kk(a);
  }
}
function kk(a) {
  for (; null !== V; ) {
    var b = V;
    if (0 !== (b.flags & 8772)) {
      var c = b.alternate;
      try {
        if (0 !== (b.flags & 8772)) switch (b.tag) {
          case 0:
          case 11:
          case 15:
            U || Qj(5, b);
            break;
          case 1:
            var d = b.stateNode;
            if (b.flags & 4 && !U) if (null === c) d.componentDidMount();
            else {
              var e = b.elementType === b.type ? c.memoizedProps : Ci(b.type, c.memoizedProps);
              d.componentDidUpdate(e, c.memoizedState, d.__reactInternalSnapshotBeforeUpdate);
            }
            var f2 = b.updateQueue;
            null !== f2 && sh(b, f2, d);
            break;
          case 3:
            var g = b.updateQueue;
            if (null !== g) {
              c = null;
              if (null !== b.child) switch (b.child.tag) {
                case 5:
                  c = b.child.stateNode;
                  break;
                case 1:
                  c = b.child.stateNode;
              }
              sh(b, g, c);
            }
            break;
          case 5:
            var h = b.stateNode;
            if (null === c && b.flags & 4) {
              c = h;
              var k2 = b.memoizedProps;
              switch (b.type) {
                case "button":
                case "input":
                case "select":
                case "textarea":
                  k2.autoFocus && c.focus();
                  break;
                case "img":
                  k2.src && (c.src = k2.src);
              }
            }
            break;
          case 6:
            break;
          case 4:
            break;
          case 12:
            break;
          case 13:
            if (null === b.memoizedState) {
              var l2 = b.alternate;
              if (null !== l2) {
                var m2 = l2.memoizedState;
                if (null !== m2) {
                  var q2 = m2.dehydrated;
                  null !== q2 && bd(q2);
                }
              }
            }
            break;
          case 19:
          case 17:
          case 21:
          case 22:
          case 23:
          case 25:
            break;
          default:
            throw Error(p(163));
        }
        U || b.flags & 512 && Rj(b);
      } catch (r2) {
        W(b, b.return, r2);
      }
    }
    if (b === a) {
      V = null;
      break;
    }
    c = b.sibling;
    if (null !== c) {
      c.return = b.return;
      V = c;
      break;
    }
    V = b.return;
  }
}
function gk(a) {
  for (; null !== V; ) {
    var b = V;
    if (b === a) {
      V = null;
      break;
    }
    var c = b.sibling;
    if (null !== c) {
      c.return = b.return;
      V = c;
      break;
    }
    V = b.return;
  }
}
function jk(a) {
  for (; null !== V; ) {
    var b = V;
    try {
      switch (b.tag) {
        case 0:
        case 11:
        case 15:
          var c = b.return;
          try {
            Qj(4, b);
          } catch (k2) {
            W(b, c, k2);
          }
          break;
        case 1:
          var d = b.stateNode;
          if ("function" === typeof d.componentDidMount) {
            var e = b.return;
            try {
              d.componentDidMount();
            } catch (k2) {
              W(b, e, k2);
            }
          }
          var f2 = b.return;
          try {
            Rj(b);
          } catch (k2) {
            W(b, f2, k2);
          }
          break;
        case 5:
          var g = b.return;
          try {
            Rj(b);
          } catch (k2) {
            W(b, g, k2);
          }
      }
    } catch (k2) {
      W(b, b.return, k2);
    }
    if (b === a) {
      V = null;
      break;
    }
    var h = b.sibling;
    if (null !== h) {
      h.return = b.return;
      V = h;
      break;
    }
    V = b.return;
  }
}
var lk = Math.ceil, mk = ua.ReactCurrentDispatcher, nk = ua.ReactCurrentOwner, ok = ua.ReactCurrentBatchConfig, K = 0, Q = null, Y = null, Z = 0, fj = 0, ej = Uf(0), T = 0, pk = null, rh = 0, qk = 0, rk = 0, sk = null, tk = null, fk = 0, Gj = Infinity, uk = null, Oi = false, Pi = null, Ri = null, vk = false, wk = null, xk = 0, yk = 0, zk = null, Ak = -1, Bk = 0;
function R() {
  return 0 !== (K & 6) ? B() : -1 !== Ak ? Ak : Ak = B();
}
function yi(a) {
  if (0 === (a.mode & 1)) return 1;
  if (0 !== (K & 2) && 0 !== Z) return Z & -Z;
  if (null !== Kg.transition) return 0 === Bk && (Bk = yc()), Bk;
  a = C;
  if (0 !== a) return a;
  a = window.event;
  a = void 0 === a ? 16 : jd(a.type);
  return a;
}
function gi(a, b, c, d) {
  if (50 < yk) throw yk = 0, zk = null, Error(p(185));
  Ac(a, c, d);
  if (0 === (K & 2) || a !== Q) a === Q && (0 === (K & 2) && (qk |= c), 4 === T && Ck(a, Z)), Dk(a, d), 1 === c && 0 === K && 0 === (b.mode & 1) && (Gj = B() + 500, fg && jg());
}
function Dk(a, b) {
  var c = a.callbackNode;
  wc(a, b);
  var d = uc(a, a === Q ? Z : 0);
  if (0 === d) null !== c && bc(c), a.callbackNode = null, a.callbackPriority = 0;
  else if (b = d & -d, a.callbackPriority !== b) {
    null != c && bc(c);
    if (1 === b) 0 === a.tag ? ig(Ek.bind(null, a)) : hg(Ek.bind(null, a)), Jf(function() {
      0 === (K & 6) && jg();
    }), c = null;
    else {
      switch (Dc(d)) {
        case 1:
          c = fc;
          break;
        case 4:
          c = gc;
          break;
        case 16:
          c = hc;
          break;
        case 536870912:
          c = jc;
          break;
        default:
          c = hc;
      }
      c = Fk(c, Gk.bind(null, a));
    }
    a.callbackPriority = b;
    a.callbackNode = c;
  }
}
function Gk(a, b) {
  Ak = -1;
  Bk = 0;
  if (0 !== (K & 6)) throw Error(p(327));
  var c = a.callbackNode;
  if (Hk() && a.callbackNode !== c) return null;
  var d = uc(a, a === Q ? Z : 0);
  if (0 === d) return null;
  if (0 !== (d & 30) || 0 !== (d & a.expiredLanes) || b) b = Ik(a, d);
  else {
    b = d;
    var e = K;
    K |= 2;
    var f2 = Jk();
    if (Q !== a || Z !== b) uk = null, Gj = B() + 500, Kk(a, b);
    do
      try {
        Lk();
        break;
      } catch (h) {
        Mk(a, h);
      }
    while (1);
    $g();
    mk.current = f2;
    K = e;
    null !== Y ? b = 0 : (Q = null, Z = 0, b = T);
  }
  if (0 !== b) {
    2 === b && (e = xc(a), 0 !== e && (d = e, b = Nk(a, e)));
    if (1 === b) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
    if (6 === b) Ck(a, d);
    else {
      e = a.current.alternate;
      if (0 === (d & 30) && !Ok(e) && (b = Ik(a, d), 2 === b && (f2 = xc(a), 0 !== f2 && (d = f2, b = Nk(a, f2))), 1 === b)) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
      a.finishedWork = e;
      a.finishedLanes = d;
      switch (b) {
        case 0:
        case 1:
          throw Error(p(345));
        case 2:
          Pk(a, tk, uk);
          break;
        case 3:
          Ck(a, d);
          if ((d & 130023424) === d && (b = fk + 500 - B(), 10 < b)) {
            if (0 !== uc(a, 0)) break;
            e = a.suspendedLanes;
            if ((e & d) !== d) {
              R();
              a.pingedLanes |= a.suspendedLanes & e;
              break;
            }
            a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), b);
            break;
          }
          Pk(a, tk, uk);
          break;
        case 4:
          Ck(a, d);
          if ((d & 4194240) === d) break;
          b = a.eventTimes;
          for (e = -1; 0 < d; ) {
            var g = 31 - oc(d);
            f2 = 1 << g;
            g = b[g];
            g > e && (e = g);
            d &= ~f2;
          }
          d = e;
          d = B() - d;
          d = (120 > d ? 120 : 480 > d ? 480 : 1080 > d ? 1080 : 1920 > d ? 1920 : 3e3 > d ? 3e3 : 4320 > d ? 4320 : 1960 * lk(d / 1960)) - d;
          if (10 < d) {
            a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), d);
            break;
          }
          Pk(a, tk, uk);
          break;
        case 5:
          Pk(a, tk, uk);
          break;
        default:
          throw Error(p(329));
      }
    }
  }
  Dk(a, B());
  return a.callbackNode === c ? Gk.bind(null, a) : null;
}
function Nk(a, b) {
  var c = sk;
  a.current.memoizedState.isDehydrated && (Kk(a, b).flags |= 256);
  a = Ik(a, b);
  2 !== a && (b = tk, tk = c, null !== b && Fj(b));
  return a;
}
function Fj(a) {
  null === tk ? tk = a : tk.push.apply(tk, a);
}
function Ok(a) {
  for (var b = a; ; ) {
    if (b.flags & 16384) {
      var c = b.updateQueue;
      if (null !== c && (c = c.stores, null !== c)) for (var d = 0; d < c.length; d++) {
        var e = c[d], f2 = e.getSnapshot;
        e = e.value;
        try {
          if (!He(f2(), e)) return false;
        } catch (g) {
          return false;
        }
      }
    }
    c = b.child;
    if (b.subtreeFlags & 16384 && null !== c) c.return = b, b = c;
    else {
      if (b === a) break;
      for (; null === b.sibling; ) {
        if (null === b.return || b.return === a) return true;
        b = b.return;
      }
      b.sibling.return = b.return;
      b = b.sibling;
    }
  }
  return true;
}
function Ck(a, b) {
  b &= ~rk;
  b &= ~qk;
  a.suspendedLanes |= b;
  a.pingedLanes &= ~b;
  for (a = a.expirationTimes; 0 < b; ) {
    var c = 31 - oc(b), d = 1 << c;
    a[c] = -1;
    b &= ~d;
  }
}
function Ek(a) {
  if (0 !== (K & 6)) throw Error(p(327));
  Hk();
  var b = uc(a, 0);
  if (0 === (b & 1)) return Dk(a, B()), null;
  var c = Ik(a, b);
  if (0 !== a.tag && 2 === c) {
    var d = xc(a);
    0 !== d && (b = d, c = Nk(a, d));
  }
  if (1 === c) throw c = pk, Kk(a, 0), Ck(a, b), Dk(a, B()), c;
  if (6 === c) throw Error(p(345));
  a.finishedWork = a.current.alternate;
  a.finishedLanes = b;
  Pk(a, tk, uk);
  Dk(a, B());
  return null;
}
function Qk(a, b) {
  var c = K;
  K |= 1;
  try {
    return a(b);
  } finally {
    K = c, 0 === K && (Gj = B() + 500, fg && jg());
  }
}
function Rk(a) {
  null !== wk && 0 === wk.tag && 0 === (K & 6) && Hk();
  var b = K;
  K |= 1;
  var c = ok.transition, d = C;
  try {
    if (ok.transition = null, C = 1, a) return a();
  } finally {
    C = d, ok.transition = c, K = b, 0 === (K & 6) && jg();
  }
}
function Hj() {
  fj = ej.current;
  E(ej);
}
function Kk(a, b) {
  a.finishedWork = null;
  a.finishedLanes = 0;
  var c = a.timeoutHandle;
  -1 !== c && (a.timeoutHandle = -1, Gf(c));
  if (null !== Y) for (c = Y.return; null !== c; ) {
    var d = c;
    wg(d);
    switch (d.tag) {
      case 1:
        d = d.type.childContextTypes;
        null !== d && void 0 !== d && $f();
        break;
      case 3:
        zh();
        E(Wf);
        E(H);
        Eh();
        break;
      case 5:
        Bh(d);
        break;
      case 4:
        zh();
        break;
      case 13:
        E(L);
        break;
      case 19:
        E(L);
        break;
      case 10:
        ah(d.type._context);
        break;
      case 22:
      case 23:
        Hj();
    }
    c = c.return;
  }
  Q = a;
  Y = a = Pg(a.current, null);
  Z = fj = b;
  T = 0;
  pk = null;
  rk = qk = rh = 0;
  tk = sk = null;
  if (null !== fh) {
    for (b = 0; b < fh.length; b++) if (c = fh[b], d = c.interleaved, null !== d) {
      c.interleaved = null;
      var e = d.next, f2 = c.pending;
      if (null !== f2) {
        var g = f2.next;
        f2.next = e;
        d.next = g;
      }
      c.pending = d;
    }
    fh = null;
  }
  return a;
}
function Mk(a, b) {
  do {
    var c = Y;
    try {
      $g();
      Fh.current = Rh;
      if (Ih) {
        for (var d = M.memoizedState; null !== d; ) {
          var e = d.queue;
          null !== e && (e.pending = null);
          d = d.next;
        }
        Ih = false;
      }
      Hh = 0;
      O = N = M = null;
      Jh = false;
      Kh = 0;
      nk.current = null;
      if (null === c || null === c.return) {
        T = 1;
        pk = b;
        Y = null;
        break;
      }
      a: {
        var f2 = a, g = c.return, h = c, k2 = b;
        b = Z;
        h.flags |= 32768;
        if (null !== k2 && "object" === typeof k2 && "function" === typeof k2.then) {
          var l2 = k2, m2 = h, q2 = m2.tag;
          if (0 === (m2.mode & 1) && (0 === q2 || 11 === q2 || 15 === q2)) {
            var r2 = m2.alternate;
            r2 ? (m2.updateQueue = r2.updateQueue, m2.memoizedState = r2.memoizedState, m2.lanes = r2.lanes) : (m2.updateQueue = null, m2.memoizedState = null);
          }
          var y2 = Ui(g);
          if (null !== y2) {
            y2.flags &= -257;
            Vi(y2, g, h, f2, b);
            y2.mode & 1 && Si(f2, l2, b);
            b = y2;
            k2 = l2;
            var n2 = b.updateQueue;
            if (null === n2) {
              var t2 = /* @__PURE__ */ new Set();
              t2.add(k2);
              b.updateQueue = t2;
            } else n2.add(k2);
            break a;
          } else {
            if (0 === (b & 1)) {
              Si(f2, l2, b);
              tj();
              break a;
            }
            k2 = Error(p(426));
          }
        } else if (I && h.mode & 1) {
          var J2 = Ui(g);
          if (null !== J2) {
            0 === (J2.flags & 65536) && (J2.flags |= 256);
            Vi(J2, g, h, f2, b);
            Jg(Ji(k2, h));
            break a;
          }
        }
        f2 = k2 = Ji(k2, h);
        4 !== T && (T = 2);
        null === sk ? sk = [f2] : sk.push(f2);
        f2 = g;
        do {
          switch (f2.tag) {
            case 3:
              f2.flags |= 65536;
              b &= -b;
              f2.lanes |= b;
              var x2 = Ni(f2, k2, b);
              ph(f2, x2);
              break a;
            case 1:
              h = k2;
              var w2 = f2.type, u2 = f2.stateNode;
              if (0 === (f2.flags & 128) && ("function" === typeof w2.getDerivedStateFromError || null !== u2 && "function" === typeof u2.componentDidCatch && (null === Ri || !Ri.has(u2)))) {
                f2.flags |= 65536;
                b &= -b;
                f2.lanes |= b;
                var F2 = Qi(f2, h, b);
                ph(f2, F2);
                break a;
              }
          }
          f2 = f2.return;
        } while (null !== f2);
      }
      Sk(c);
    } catch (na) {
      b = na;
      Y === c && null !== c && (Y = c = c.return);
      continue;
    }
    break;
  } while (1);
}
function Jk() {
  var a = mk.current;
  mk.current = Rh;
  return null === a ? Rh : a;
}
function tj() {
  if (0 === T || 3 === T || 2 === T) T = 4;
  null === Q || 0 === (rh & 268435455) && 0 === (qk & 268435455) || Ck(Q, Z);
}
function Ik(a, b) {
  var c = K;
  K |= 2;
  var d = Jk();
  if (Q !== a || Z !== b) uk = null, Kk(a, b);
  do
    try {
      Tk();
      break;
    } catch (e) {
      Mk(a, e);
    }
  while (1);
  $g();
  K = c;
  mk.current = d;
  if (null !== Y) throw Error(p(261));
  Q = null;
  Z = 0;
  return T;
}
function Tk() {
  for (; null !== Y; ) Uk(Y);
}
function Lk() {
  for (; null !== Y && !cc(); ) Uk(Y);
}
function Uk(a) {
  var b = Vk(a.alternate, a, fj);
  a.memoizedProps = a.pendingProps;
  null === b ? Sk(a) : Y = b;
  nk.current = null;
}
function Sk(a) {
  var b = a;
  do {
    var c = b.alternate;
    a = b.return;
    if (0 === (b.flags & 32768)) {
      if (c = Ej(c, b, fj), null !== c) {
        Y = c;
        return;
      }
    } else {
      c = Ij(c, b);
      if (null !== c) {
        c.flags &= 32767;
        Y = c;
        return;
      }
      if (null !== a) a.flags |= 32768, a.subtreeFlags = 0, a.deletions = null;
      else {
        T = 6;
        Y = null;
        return;
      }
    }
    b = b.sibling;
    if (null !== b) {
      Y = b;
      return;
    }
    Y = b = a;
  } while (null !== b);
  0 === T && (T = 5);
}
function Pk(a, b, c) {
  var d = C, e = ok.transition;
  try {
    ok.transition = null, C = 1, Wk(a, b, c, d);
  } finally {
    ok.transition = e, C = d;
  }
  return null;
}
function Wk(a, b, c, d) {
  do
    Hk();
  while (null !== wk);
  if (0 !== (K & 6)) throw Error(p(327));
  c = a.finishedWork;
  var e = a.finishedLanes;
  if (null === c) return null;
  a.finishedWork = null;
  a.finishedLanes = 0;
  if (c === a.current) throw Error(p(177));
  a.callbackNode = null;
  a.callbackPriority = 0;
  var f2 = c.lanes | c.childLanes;
  Bc(a, f2);
  a === Q && (Y = Q = null, Z = 0);
  0 === (c.subtreeFlags & 2064) && 0 === (c.flags & 2064) || vk || (vk = true, Fk(hc, function() {
    Hk();
    return null;
  }));
  f2 = 0 !== (c.flags & 15990);
  if (0 !== (c.subtreeFlags & 15990) || f2) {
    f2 = ok.transition;
    ok.transition = null;
    var g = C;
    C = 1;
    var h = K;
    K |= 4;
    nk.current = null;
    Oj(a, c);
    dk(c, a);
    Oe(Df);
    dd = !!Cf;
    Df = Cf = null;
    a.current = c;
    hk(c);
    dc();
    K = h;
    C = g;
    ok.transition = f2;
  } else a.current = c;
  vk && (vk = false, wk = a, xk = e);
  f2 = a.pendingLanes;
  0 === f2 && (Ri = null);
  mc(c.stateNode);
  Dk(a, B());
  if (null !== b) for (d = a.onRecoverableError, c = 0; c < b.length; c++) e = b[c], d(e.value, { componentStack: e.stack, digest: e.digest });
  if (Oi) throw Oi = false, a = Pi, Pi = null, a;
  0 !== (xk & 1) && 0 !== a.tag && Hk();
  f2 = a.pendingLanes;
  0 !== (f2 & 1) ? a === zk ? yk++ : (yk = 0, zk = a) : yk = 0;
  jg();
  return null;
}
function Hk() {
  if (null !== wk) {
    var a = Dc(xk), b = ok.transition, c = C;
    try {
      ok.transition = null;
      C = 16 > a ? 16 : a;
      if (null === wk) var d = false;
      else {
        a = wk;
        wk = null;
        xk = 0;
        if (0 !== (K & 6)) throw Error(p(331));
        var e = K;
        K |= 4;
        for (V = a.current; null !== V; ) {
          var f2 = V, g = f2.child;
          if (0 !== (V.flags & 16)) {
            var h = f2.deletions;
            if (null !== h) {
              for (var k2 = 0; k2 < h.length; k2++) {
                var l2 = h[k2];
                for (V = l2; null !== V; ) {
                  var m2 = V;
                  switch (m2.tag) {
                    case 0:
                    case 11:
                    case 15:
                      Pj(8, m2, f2);
                  }
                  var q2 = m2.child;
                  if (null !== q2) q2.return = m2, V = q2;
                  else for (; null !== V; ) {
                    m2 = V;
                    var r2 = m2.sibling, y2 = m2.return;
                    Sj(m2);
                    if (m2 === l2) {
                      V = null;
                      break;
                    }
                    if (null !== r2) {
                      r2.return = y2;
                      V = r2;
                      break;
                    }
                    V = y2;
                  }
                }
              }
              var n2 = f2.alternate;
              if (null !== n2) {
                var t2 = n2.child;
                if (null !== t2) {
                  n2.child = null;
                  do {
                    var J2 = t2.sibling;
                    t2.sibling = null;
                    t2 = J2;
                  } while (null !== t2);
                }
              }
              V = f2;
            }
          }
          if (0 !== (f2.subtreeFlags & 2064) && null !== g) g.return = f2, V = g;
          else b: for (; null !== V; ) {
            f2 = V;
            if (0 !== (f2.flags & 2048)) switch (f2.tag) {
              case 0:
              case 11:
              case 15:
                Pj(9, f2, f2.return);
            }
            var x2 = f2.sibling;
            if (null !== x2) {
              x2.return = f2.return;
              V = x2;
              break b;
            }
            V = f2.return;
          }
        }
        var w2 = a.current;
        for (V = w2; null !== V; ) {
          g = V;
          var u2 = g.child;
          if (0 !== (g.subtreeFlags & 2064) && null !== u2) u2.return = g, V = u2;
          else b: for (g = w2; null !== V; ) {
            h = V;
            if (0 !== (h.flags & 2048)) try {
              switch (h.tag) {
                case 0:
                case 11:
                case 15:
                  Qj(9, h);
              }
            } catch (na) {
              W(h, h.return, na);
            }
            if (h === g) {
              V = null;
              break b;
            }
            var F2 = h.sibling;
            if (null !== F2) {
              F2.return = h.return;
              V = F2;
              break b;
            }
            V = h.return;
          }
        }
        K = e;
        jg();
        if (lc && "function" === typeof lc.onPostCommitFiberRoot) try {
          lc.onPostCommitFiberRoot(kc, a);
        } catch (na) {
        }
        d = true;
      }
      return d;
    } finally {
      C = c, ok.transition = b;
    }
  }
  return false;
}
function Xk(a, b, c) {
  b = Ji(c, b);
  b = Ni(a, b, 1);
  a = nh(a, b, 1);
  b = R();
  null !== a && (Ac(a, 1, b), Dk(a, b));
}
function W(a, b, c) {
  if (3 === a.tag) Xk(a, a, c);
  else for (; null !== b; ) {
    if (3 === b.tag) {
      Xk(b, a, c);
      break;
    } else if (1 === b.tag) {
      var d = b.stateNode;
      if ("function" === typeof b.type.getDerivedStateFromError || "function" === typeof d.componentDidCatch && (null === Ri || !Ri.has(d))) {
        a = Ji(c, a);
        a = Qi(b, a, 1);
        b = nh(b, a, 1);
        a = R();
        null !== b && (Ac(b, 1, a), Dk(b, a));
        break;
      }
    }
    b = b.return;
  }
}
function Ti(a, b, c) {
  var d = a.pingCache;
  null !== d && d.delete(b);
  b = R();
  a.pingedLanes |= a.suspendedLanes & c;
  Q === a && (Z & c) === c && (4 === T || 3 === T && (Z & 130023424) === Z && 500 > B() - fk ? Kk(a, 0) : rk |= c);
  Dk(a, b);
}
function Yk(a, b) {
  0 === b && (0 === (a.mode & 1) ? b = 1 : (b = sc, sc <<= 1, 0 === (sc & 130023424) && (sc = 4194304)));
  var c = R();
  a = ih(a, b);
  null !== a && (Ac(a, b, c), Dk(a, c));
}
function uj(a) {
  var b = a.memoizedState, c = 0;
  null !== b && (c = b.retryLane);
  Yk(a, c);
}
function bk(a, b) {
  var c = 0;
  switch (a.tag) {
    case 13:
      var d = a.stateNode;
      var e = a.memoizedState;
      null !== e && (c = e.retryLane);
      break;
    case 19:
      d = a.stateNode;
      break;
    default:
      throw Error(p(314));
  }
  null !== d && d.delete(b);
  Yk(a, c);
}
var Vk;
Vk = function(a, b, c) {
  if (null !== a) if (a.memoizedProps !== b.pendingProps || Wf.current) dh = true;
  else {
    if (0 === (a.lanes & c) && 0 === (b.flags & 128)) return dh = false, yj(a, b, c);
    dh = 0 !== (a.flags & 131072) ? true : false;
  }
  else dh = false, I && 0 !== (b.flags & 1048576) && ug(b, ng, b.index);
  b.lanes = 0;
  switch (b.tag) {
    case 2:
      var d = b.type;
      ij(a, b);
      a = b.pendingProps;
      var e = Yf(b, H.current);
      ch(b, c);
      e = Nh(null, b, d, a, e, c);
      var f2 = Sh();
      b.flags |= 1;
      "object" === typeof e && null !== e && "function" === typeof e.render && void 0 === e.$$typeof ? (b.tag = 1, b.memoizedState = null, b.updateQueue = null, Zf(d) ? (f2 = true, cg(b)) : f2 = false, b.memoizedState = null !== e.state && void 0 !== e.state ? e.state : null, kh(b), e.updater = Ei, b.stateNode = e, e._reactInternals = b, Ii(b, d, a, c), b = jj(null, b, d, true, f2, c)) : (b.tag = 0, I && f2 && vg(b), Xi(null, b, e, c), b = b.child);
      return b;
    case 16:
      d = b.elementType;
      a: {
        ij(a, b);
        a = b.pendingProps;
        e = d._init;
        d = e(d._payload);
        b.type = d;
        e = b.tag = Zk(d);
        a = Ci(d, a);
        switch (e) {
          case 0:
            b = cj(null, b, d, a, c);
            break a;
          case 1:
            b = hj(null, b, d, a, c);
            break a;
          case 11:
            b = Yi(null, b, d, a, c);
            break a;
          case 14:
            b = $i(null, b, d, Ci(d.type, a), c);
            break a;
        }
        throw Error(p(
          306,
          d,
          ""
        ));
      }
      return b;
    case 0:
      return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), cj(a, b, d, e, c);
    case 1:
      return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), hj(a, b, d, e, c);
    case 3:
      a: {
        kj(b);
        if (null === a) throw Error(p(387));
        d = b.pendingProps;
        f2 = b.memoizedState;
        e = f2.element;
        lh(a, b);
        qh(b, d, null, c);
        var g = b.memoizedState;
        d = g.element;
        if (f2.isDehydrated) if (f2 = { element: d, isDehydrated: false, cache: g.cache, pendingSuspenseBoundaries: g.pendingSuspenseBoundaries, transitions: g.transitions }, b.updateQueue.baseState = f2, b.memoizedState = f2, b.flags & 256) {
          e = Ji(Error(p(423)), b);
          b = lj(a, b, d, c, e);
          break a;
        } else if (d !== e) {
          e = Ji(Error(p(424)), b);
          b = lj(a, b, d, c, e);
          break a;
        } else for (yg = Lf(b.stateNode.containerInfo.firstChild), xg = b, I = true, zg = null, c = Vg(b, null, d, c), b.child = c; c; ) c.flags = c.flags & -3 | 4096, c = c.sibling;
        else {
          Ig();
          if (d === e) {
            b = Zi(a, b, c);
            break a;
          }
          Xi(a, b, d, c);
        }
        b = b.child;
      }
      return b;
    case 5:
      return Ah(b), null === a && Eg(b), d = b.type, e = b.pendingProps, f2 = null !== a ? a.memoizedProps : null, g = e.children, Ef(d, e) ? g = null : null !== f2 && Ef(d, f2) && (b.flags |= 32), gj(a, b), Xi(a, b, g, c), b.child;
    case 6:
      return null === a && Eg(b), null;
    case 13:
      return oj(a, b, c);
    case 4:
      return yh(b, b.stateNode.containerInfo), d = b.pendingProps, null === a ? b.child = Ug(b, null, d, c) : Xi(a, b, d, c), b.child;
    case 11:
      return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), Yi(a, b, d, e, c);
    case 7:
      return Xi(a, b, b.pendingProps, c), b.child;
    case 8:
      return Xi(a, b, b.pendingProps.children, c), b.child;
    case 12:
      return Xi(a, b, b.pendingProps.children, c), b.child;
    case 10:
      a: {
        d = b.type._context;
        e = b.pendingProps;
        f2 = b.memoizedProps;
        g = e.value;
        G(Wg, d._currentValue);
        d._currentValue = g;
        if (null !== f2) if (He(f2.value, g)) {
          if (f2.children === e.children && !Wf.current) {
            b = Zi(a, b, c);
            break a;
          }
        } else for (f2 = b.child, null !== f2 && (f2.return = b); null !== f2; ) {
          var h = f2.dependencies;
          if (null !== h) {
            g = f2.child;
            for (var k2 = h.firstContext; null !== k2; ) {
              if (k2.context === d) {
                if (1 === f2.tag) {
                  k2 = mh(-1, c & -c);
                  k2.tag = 2;
                  var l2 = f2.updateQueue;
                  if (null !== l2) {
                    l2 = l2.shared;
                    var m2 = l2.pending;
                    null === m2 ? k2.next = k2 : (k2.next = m2.next, m2.next = k2);
                    l2.pending = k2;
                  }
                }
                f2.lanes |= c;
                k2 = f2.alternate;
                null !== k2 && (k2.lanes |= c);
                bh(
                  f2.return,
                  c,
                  b
                );
                h.lanes |= c;
                break;
              }
              k2 = k2.next;
            }
          } else if (10 === f2.tag) g = f2.type === b.type ? null : f2.child;
          else if (18 === f2.tag) {
            g = f2.return;
            if (null === g) throw Error(p(341));
            g.lanes |= c;
            h = g.alternate;
            null !== h && (h.lanes |= c);
            bh(g, c, b);
            g = f2.sibling;
          } else g = f2.child;
          if (null !== g) g.return = f2;
          else for (g = f2; null !== g; ) {
            if (g === b) {
              g = null;
              break;
            }
            f2 = g.sibling;
            if (null !== f2) {
              f2.return = g.return;
              g = f2;
              break;
            }
            g = g.return;
          }
          f2 = g;
        }
        Xi(a, b, e.children, c);
        b = b.child;
      }
      return b;
    case 9:
      return e = b.type, d = b.pendingProps.children, ch(b, c), e = eh(e), d = d(e), b.flags |= 1, Xi(a, b, d, c), b.child;
    case 14:
      return d = b.type, e = Ci(d, b.pendingProps), e = Ci(d.type, e), $i(a, b, d, e, c);
    case 15:
      return bj(a, b, b.type, b.pendingProps, c);
    case 17:
      return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), ij(a, b), b.tag = 1, Zf(d) ? (a = true, cg(b)) : a = false, ch(b, c), Gi(b, d, e), Ii(b, d, e, c), jj(null, b, d, true, a, c);
    case 19:
      return xj(a, b, c);
    case 22:
      return dj(a, b, c);
  }
  throw Error(p(156, b.tag));
};
function Fk(a, b) {
  return ac(a, b);
}
function $k(a, b, c, d) {
  this.tag = a;
  this.key = c;
  this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null;
  this.index = 0;
  this.ref = null;
  this.pendingProps = b;
  this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null;
  this.mode = d;
  this.subtreeFlags = this.flags = 0;
  this.deletions = null;
  this.childLanes = this.lanes = 0;
  this.alternate = null;
}
function Bg(a, b, c, d) {
  return new $k(a, b, c, d);
}
function aj(a) {
  a = a.prototype;
  return !(!a || !a.isReactComponent);
}
function Zk(a) {
  if ("function" === typeof a) return aj(a) ? 1 : 0;
  if (void 0 !== a && null !== a) {
    a = a.$$typeof;
    if (a === Da) return 11;
    if (a === Ga) return 14;
  }
  return 2;
}
function Pg(a, b) {
  var c = a.alternate;
  null === c ? (c = Bg(a.tag, b, a.key, a.mode), c.elementType = a.elementType, c.type = a.type, c.stateNode = a.stateNode, c.alternate = a, a.alternate = c) : (c.pendingProps = b, c.type = a.type, c.flags = 0, c.subtreeFlags = 0, c.deletions = null);
  c.flags = a.flags & 14680064;
  c.childLanes = a.childLanes;
  c.lanes = a.lanes;
  c.child = a.child;
  c.memoizedProps = a.memoizedProps;
  c.memoizedState = a.memoizedState;
  c.updateQueue = a.updateQueue;
  b = a.dependencies;
  c.dependencies = null === b ? null : { lanes: b.lanes, firstContext: b.firstContext };
  c.sibling = a.sibling;
  c.index = a.index;
  c.ref = a.ref;
  return c;
}
function Rg(a, b, c, d, e, f2) {
  var g = 2;
  d = a;
  if ("function" === typeof a) aj(a) && (g = 1);
  else if ("string" === typeof a) g = 5;
  else a: switch (a) {
    case ya:
      return Tg(c.children, e, f2, b);
    case za:
      g = 8;
      e |= 8;
      break;
    case Aa:
      return a = Bg(12, c, b, e | 2), a.elementType = Aa, a.lanes = f2, a;
    case Ea:
      return a = Bg(13, c, b, e), a.elementType = Ea, a.lanes = f2, a;
    case Fa:
      return a = Bg(19, c, b, e), a.elementType = Fa, a.lanes = f2, a;
    case Ia:
      return pj(c, e, f2, b);
    default:
      if ("object" === typeof a && null !== a) switch (a.$$typeof) {
        case Ba:
          g = 10;
          break a;
        case Ca:
          g = 9;
          break a;
        case Da:
          g = 11;
          break a;
        case Ga:
          g = 14;
          break a;
        case Ha:
          g = 16;
          d = null;
          break a;
      }
      throw Error(p(130, null == a ? a : typeof a, ""));
  }
  b = Bg(g, c, b, e);
  b.elementType = a;
  b.type = d;
  b.lanes = f2;
  return b;
}
function Tg(a, b, c, d) {
  a = Bg(7, a, d, b);
  a.lanes = c;
  return a;
}
function pj(a, b, c, d) {
  a = Bg(22, a, d, b);
  a.elementType = Ia;
  a.lanes = c;
  a.stateNode = { isHidden: false };
  return a;
}
function Qg(a, b, c) {
  a = Bg(6, a, null, b);
  a.lanes = c;
  return a;
}
function Sg(a, b, c) {
  b = Bg(4, null !== a.children ? a.children : [], a.key, b);
  b.lanes = c;
  b.stateNode = { containerInfo: a.containerInfo, pendingChildren: null, implementation: a.implementation };
  return b;
}
function al(a, b, c, d, e) {
  this.tag = b;
  this.containerInfo = a;
  this.finishedWork = this.pingCache = this.current = this.pendingChildren = null;
  this.timeoutHandle = -1;
  this.callbackNode = this.pendingContext = this.context = null;
  this.callbackPriority = 0;
  this.eventTimes = zc(0);
  this.expirationTimes = zc(-1);
  this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0;
  this.entanglements = zc(0);
  this.identifierPrefix = d;
  this.onRecoverableError = e;
  this.mutableSourceEagerHydrationData = null;
}
function bl(a, b, c, d, e, f2, g, h, k2) {
  a = new al(a, b, c, h, k2);
  1 === b ? (b = 1, true === f2 && (b |= 8)) : b = 0;
  f2 = Bg(3, null, null, b);
  a.current = f2;
  f2.stateNode = a;
  f2.memoizedState = { element: d, isDehydrated: c, cache: null, transitions: null, pendingSuspenseBoundaries: null };
  kh(f2);
  return a;
}
function cl(a, b, c) {
  var d = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
  return { $$typeof: wa, key: null == d ? null : "" + d, children: a, containerInfo: b, implementation: c };
}
function dl(a) {
  if (!a) return Vf;
  a = a._reactInternals;
  a: {
    if (Vb(a) !== a || 1 !== a.tag) throw Error(p(170));
    var b = a;
    do {
      switch (b.tag) {
        case 3:
          b = b.stateNode.context;
          break a;
        case 1:
          if (Zf(b.type)) {
            b = b.stateNode.__reactInternalMemoizedMergedChildContext;
            break a;
          }
      }
      b = b.return;
    } while (null !== b);
    throw Error(p(171));
  }
  if (1 === a.tag) {
    var c = a.type;
    if (Zf(c)) return bg(a, c, b);
  }
  return b;
}
function el(a, b, c, d, e, f2, g, h, k2) {
  a = bl(c, d, true, a, e, f2, g, h, k2);
  a.context = dl(null);
  c = a.current;
  d = R();
  e = yi(c);
  f2 = mh(d, e);
  f2.callback = void 0 !== b && null !== b ? b : null;
  nh(c, f2, e);
  a.current.lanes = e;
  Ac(a, e, d);
  Dk(a, d);
  return a;
}
function fl(a, b, c, d) {
  var e = b.current, f2 = R(), g = yi(e);
  c = dl(c);
  null === b.context ? b.context = c : b.pendingContext = c;
  b = mh(f2, g);
  b.payload = { element: a };
  d = void 0 === d ? null : d;
  null !== d && (b.callback = d);
  a = nh(e, b, g);
  null !== a && (gi(a, e, g, f2), oh(a, e, g));
  return g;
}
function gl(a) {
  a = a.current;
  if (!a.child) return null;
  switch (a.child.tag) {
    case 5:
      return a.child.stateNode;
    default:
      return a.child.stateNode;
  }
}
function hl(a, b) {
  a = a.memoizedState;
  if (null !== a && null !== a.dehydrated) {
    var c = a.retryLane;
    a.retryLane = 0 !== c && c < b ? c : b;
  }
}
function il(a, b) {
  hl(a, b);
  (a = a.alternate) && hl(a, b);
}
function jl() {
  return null;
}
var kl = "function" === typeof reportError ? reportError : function(a) {
  console.error(a);
};
function ll(a) {
  this._internalRoot = a;
}
ml.prototype.render = ll.prototype.render = function(a) {
  var b = this._internalRoot;
  if (null === b) throw Error(p(409));
  fl(a, b, null, null);
};
ml.prototype.unmount = ll.prototype.unmount = function() {
  var a = this._internalRoot;
  if (null !== a) {
    this._internalRoot = null;
    var b = a.containerInfo;
    Rk(function() {
      fl(null, a, null, null);
    });
    b[uf] = null;
  }
};
function ml(a) {
  this._internalRoot = a;
}
ml.prototype.unstable_scheduleHydration = function(a) {
  if (a) {
    var b = Hc();
    a = { blockedOn: null, target: a, priority: b };
    for (var c = 0; c < Qc.length && 0 !== b && b < Qc[c].priority; c++) ;
    Qc.splice(c, 0, a);
    0 === c && Vc(a);
  }
};
function nl(a) {
  return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType);
}
function ol(a) {
  return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType && (8 !== a.nodeType || " react-mount-point-unstable " !== a.nodeValue));
}
function pl() {
}
function ql(a, b, c, d, e) {
  if (e) {
    if ("function" === typeof d) {
      var f2 = d;
      d = function() {
        var a2 = gl(g);
        f2.call(a2);
      };
    }
    var g = el(b, d, a, 0, null, false, false, "", pl);
    a._reactRootContainer = g;
    a[uf] = g.current;
    sf(8 === a.nodeType ? a.parentNode : a);
    Rk();
    return g;
  }
  for (; e = a.lastChild; ) a.removeChild(e);
  if ("function" === typeof d) {
    var h = d;
    d = function() {
      var a2 = gl(k2);
      h.call(a2);
    };
  }
  var k2 = bl(a, 0, false, null, null, false, false, "", pl);
  a._reactRootContainer = k2;
  a[uf] = k2.current;
  sf(8 === a.nodeType ? a.parentNode : a);
  Rk(function() {
    fl(b, k2, c, d);
  });
  return k2;
}
function rl(a, b, c, d, e) {
  var f2 = c._reactRootContainer;
  if (f2) {
    var g = f2;
    if ("function" === typeof e) {
      var h = e;
      e = function() {
        var a2 = gl(g);
        h.call(a2);
      };
    }
    fl(b, g, a, e);
  } else g = ql(c, b, a, e, d);
  return gl(g);
}
Ec = function(a) {
  switch (a.tag) {
    case 3:
      var b = a.stateNode;
      if (b.current.memoizedState.isDehydrated) {
        var c = tc(b.pendingLanes);
        0 !== c && (Cc(b, c | 1), Dk(b, B()), 0 === (K & 6) && (Gj = B() + 500, jg()));
      }
      break;
    case 13:
      Rk(function() {
        var b2 = ih(a, 1);
        if (null !== b2) {
          var c2 = R();
          gi(b2, a, 1, c2);
        }
      }), il(a, 1);
  }
};
Fc = function(a) {
  if (13 === a.tag) {
    var b = ih(a, 134217728);
    if (null !== b) {
      var c = R();
      gi(b, a, 134217728, c);
    }
    il(a, 134217728);
  }
};
Gc = function(a) {
  if (13 === a.tag) {
    var b = yi(a), c = ih(a, b);
    if (null !== c) {
      var d = R();
      gi(c, a, b, d);
    }
    il(a, b);
  }
};
Hc = function() {
  return C;
};
Ic = function(a, b) {
  var c = C;
  try {
    return C = a, b();
  } finally {
    C = c;
  }
};
yb = function(a, b, c) {
  switch (b) {
    case "input":
      bb(a, c);
      b = c.name;
      if ("radio" === c.type && null != b) {
        for (c = a; c.parentNode; ) c = c.parentNode;
        c = c.querySelectorAll("input[name=" + JSON.stringify("" + b) + '][type="radio"]');
        for (b = 0; b < c.length; b++) {
          var d = c[b];
          if (d !== a && d.form === a.form) {
            var e = Db(d);
            if (!e) throw Error(p(90));
            Wa(d);
            bb(d, e);
          }
        }
      }
      break;
    case "textarea":
      ib(a, c);
      break;
    case "select":
      b = c.value, null != b && fb(a, !!c.multiple, b, false);
  }
};
Gb = Qk;
Hb = Rk;
var sl = { usingClientEntryPoint: false, Events: [Cb, ue, Db, Eb, Fb, Qk] }, tl = { findFiberByHostInstance: Wc, bundleType: 0, version: "18.3.1", rendererPackageName: "react-dom" };
var ul = { bundleType: tl.bundleType, version: tl.version, rendererPackageName: tl.rendererPackageName, rendererConfig: tl.rendererConfig, overrideHookState: null, overrideHookStateDeletePath: null, overrideHookStateRenamePath: null, overrideProps: null, overridePropsDeletePath: null, overridePropsRenamePath: null, setErrorHandler: null, setSuspenseHandler: null, scheduleUpdate: null, currentDispatcherRef: ua.ReactCurrentDispatcher, findHostInstanceByFiber: function(a) {
  a = Zb(a);
  return null === a ? null : a.stateNode;
}, findFiberByHostInstance: tl.findFiberByHostInstance || jl, findHostInstancesForRefresh: null, scheduleRefresh: null, scheduleRoot: null, setRefreshHandler: null, getCurrentFiber: null, reconcilerVersion: "18.3.1-next-f1338f8080-20240426" };
if ("undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) {
  var vl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!vl.isDisabled && vl.supportsFiber) try {
    kc = vl.inject(ul), lc = vl;
  } catch (a) {
  }
}
reactDom_production_min.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = sl;
reactDom_production_min.createPortal = function(a, b) {
  var c = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
  if (!nl(b)) throw Error(p(200));
  return cl(a, b, null, c);
};
reactDom_production_min.createRoot = function(a, b) {
  if (!nl(a)) throw Error(p(299));
  var c = false, d = "", e = kl;
  null !== b && void 0 !== b && (true === b.unstable_strictMode && (c = true), void 0 !== b.identifierPrefix && (d = b.identifierPrefix), void 0 !== b.onRecoverableError && (e = b.onRecoverableError));
  b = bl(a, 1, false, null, null, c, false, d, e);
  a[uf] = b.current;
  sf(8 === a.nodeType ? a.parentNode : a);
  return new ll(b);
};
reactDom_production_min.findDOMNode = function(a) {
  if (null == a) return null;
  if (1 === a.nodeType) return a;
  var b = a._reactInternals;
  if (void 0 === b) {
    if ("function" === typeof a.render) throw Error(p(188));
    a = Object.keys(a).join(",");
    throw Error(p(268, a));
  }
  a = Zb(b);
  a = null === a ? null : a.stateNode;
  return a;
};
reactDom_production_min.flushSync = function(a) {
  return Rk(a);
};
reactDom_production_min.hydrate = function(a, b, c) {
  if (!ol(b)) throw Error(p(200));
  return rl(null, a, b, true, c);
};
reactDom_production_min.hydrateRoot = function(a, b, c) {
  if (!nl(a)) throw Error(p(405));
  var d = null != c && c.hydratedSources || null, e = false, f2 = "", g = kl;
  null !== c && void 0 !== c && (true === c.unstable_strictMode && (e = true), void 0 !== c.identifierPrefix && (f2 = c.identifierPrefix), void 0 !== c.onRecoverableError && (g = c.onRecoverableError));
  b = el(b, null, a, 1, null != c ? c : null, e, false, f2, g);
  a[uf] = b.current;
  sf(a);
  if (d) for (a = 0; a < d.length; a++) c = d[a], e = c._getVersion, e = e(c._source), null == b.mutableSourceEagerHydrationData ? b.mutableSourceEagerHydrationData = [c, e] : b.mutableSourceEagerHydrationData.push(
    c,
    e
  );
  return new ml(b);
};
reactDom_production_min.render = function(a, b, c) {
  if (!ol(b)) throw Error(p(200));
  return rl(null, a, b, false, c);
};
reactDom_production_min.unmountComponentAtNode = function(a) {
  if (!ol(a)) throw Error(p(40));
  return a._reactRootContainer ? (Rk(function() {
    rl(null, null, a, false, function() {
      a._reactRootContainer = null;
      a[uf] = null;
    });
  }), true) : false;
};
reactDom_production_min.unstable_batchedUpdates = Qk;
reactDom_production_min.unstable_renderSubtreeIntoContainer = function(a, b, c, d) {
  if (!ol(c)) throw Error(p(200));
  if (null == a || void 0 === a._reactInternals) throw Error(p(38));
  return rl(a, b, c, false, d);
};
reactDom_production_min.version = "18.3.1-next-f1338f8080-20240426";
function checkDCE() {
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") {
    return;
  }
  try {
    __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
  } catch (err) {
    console.error(err);
  }
}
{
  checkDCE();
  reactDom.exports = reactDom_production_min;
}
var reactDomExports = reactDom.exports;
const ReactDOM = /* @__PURE__ */ getDefaultExportFromCjs(reactDomExports);
var m = reactDomExports;
{
  client.createRoot = m.createRoot;
  client.hydrateRoot = m.hydrateRoot;
}
/**
 * @remix-run/router v1.23.2
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */
function _extends$2() {
  _extends$2 = Object.assign ? Object.assign.bind() : function(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };
  return _extends$2.apply(this, arguments);
}
var Action$1;
(function(Action2) {
  Action2["Pop"] = "POP";
  Action2["Push"] = "PUSH";
  Action2["Replace"] = "REPLACE";
})(Action$1 || (Action$1 = {}));
const PopStateEventType = "popstate";
function createHashHistory(options) {
  if (options === void 0) {
    options = {};
  }
  function createHashLocation(window2, globalHistory) {
    let {
      pathname = "/",
      search = "",
      hash: hash2 = ""
    } = parsePath(window2.location.hash.substr(1));
    if (!pathname.startsWith("/") && !pathname.startsWith(".")) {
      pathname = "/" + pathname;
    }
    return createLocation(
      "",
      {
        pathname,
        search,
        hash: hash2
      },
      // state defaults to `null` because `window.history.state` does
      globalHistory.state && globalHistory.state.usr || null,
      globalHistory.state && globalHistory.state.key || "default"
    );
  }
  function createHashHref(window2, to) {
    let base = window2.document.querySelector("base");
    let href = "";
    if (base && base.getAttribute("href")) {
      let url = window2.location.href;
      let hashIndex = url.indexOf("#");
      href = hashIndex === -1 ? url : url.slice(0, hashIndex);
    }
    return href + "#" + (typeof to === "string" ? to : createPath(to));
  }
  function validateHashLocation(location2, to) {
    warning(location2.pathname.charAt(0) === "/", "relative pathnames are not supported in hash history.push(" + JSON.stringify(to) + ")");
  }
  return getUrlBasedHistory(createHashLocation, createHashHref, validateHashLocation, options);
}
function invariant(value, message) {
  if (value === false || value === null || typeof value === "undefined") {
    throw new Error(message);
  }
}
function warning(cond, message) {
  if (!cond) {
    if (typeof console !== "undefined") console.warn(message);
    try {
      throw new Error(message);
    } catch (e) {
    }
  }
}
function createKey() {
  return Math.random().toString(36).substr(2, 8);
}
function getHistoryState(location2, index) {
  return {
    usr: location2.state,
    key: location2.key,
    idx: index
  };
}
function createLocation(current, to, state, key) {
  if (state === void 0) {
    state = null;
  }
  let location2 = _extends$2({
    pathname: typeof current === "string" ? current : current.pathname,
    search: "",
    hash: ""
  }, typeof to === "string" ? parsePath(to) : to, {
    state,
    // TODO: This could be cleaned up.  push/replace should probably just take
    // full Locations now and avoid the need to run through this flow at all
    // But that's a pretty big refactor to the current test suite so going to
    // keep as is for the time being and just let any incoming keys take precedence
    key: to && to.key || key || createKey()
  });
  return location2;
}
function createPath(_ref) {
  let {
    pathname = "/",
    search = "",
    hash: hash2 = ""
  } = _ref;
  if (search && search !== "?") pathname += search.charAt(0) === "?" ? search : "?" + search;
  if (hash2 && hash2 !== "#") pathname += hash2.charAt(0) === "#" ? hash2 : "#" + hash2;
  return pathname;
}
function parsePath(path2) {
  let parsedPath = {};
  if (path2) {
    let hashIndex = path2.indexOf("#");
    if (hashIndex >= 0) {
      parsedPath.hash = path2.substr(hashIndex);
      path2 = path2.substr(0, hashIndex);
    }
    let searchIndex = path2.indexOf("?");
    if (searchIndex >= 0) {
      parsedPath.search = path2.substr(searchIndex);
      path2 = path2.substr(0, searchIndex);
    }
    if (path2) {
      parsedPath.pathname = path2;
    }
  }
  return parsedPath;
}
function getUrlBasedHistory(getLocation, createHref, validateLocation, options) {
  if (options === void 0) {
    options = {};
  }
  let {
    window: window2 = document.defaultView,
    v5Compat = false
  } = options;
  let globalHistory = window2.history;
  let action = Action$1.Pop;
  let listener = null;
  let index = getIndex();
  if (index == null) {
    index = 0;
    globalHistory.replaceState(_extends$2({}, globalHistory.state, {
      idx: index
    }), "");
  }
  function getIndex() {
    let state = globalHistory.state || {
      idx: null
    };
    return state.idx;
  }
  function handlePop() {
    action = Action$1.Pop;
    let nextIndex = getIndex();
    let delta = nextIndex == null ? null : nextIndex - index;
    index = nextIndex;
    if (listener) {
      listener({
        action,
        location: history.location,
        delta
      });
    }
  }
  function push(to, state) {
    action = Action$1.Push;
    let location2 = createLocation(history.location, to, state);
    if (validateLocation) validateLocation(location2, to);
    index = getIndex() + 1;
    let historyState = getHistoryState(location2, index);
    let url = history.createHref(location2);
    try {
      globalHistory.pushState(historyState, "", url);
    } catch (error) {
      if (error instanceof DOMException && error.name === "DataCloneError") {
        throw error;
      }
      window2.location.assign(url);
    }
    if (v5Compat && listener) {
      listener({
        action,
        location: history.location,
        delta: 1
      });
    }
  }
  function replace(to, state) {
    action = Action$1.Replace;
    let location2 = createLocation(history.location, to, state);
    if (validateLocation) validateLocation(location2, to);
    index = getIndex();
    let historyState = getHistoryState(location2, index);
    let url = history.createHref(location2);
    globalHistory.replaceState(historyState, "", url);
    if (v5Compat && listener) {
      listener({
        action,
        location: history.location,
        delta: 0
      });
    }
  }
  function createURL(to) {
    let base = window2.location.origin !== "null" ? window2.location.origin : window2.location.href;
    let href = typeof to === "string" ? to : createPath(to);
    href = href.replace(/ $/, "%20");
    invariant(base, "No window.location.(origin|href) available to create URL for href: " + href);
    return new URL(href, base);
  }
  let history = {
    get action() {
      return action;
    },
    get location() {
      return getLocation(window2, globalHistory);
    },
    listen(fn) {
      if (listener) {
        throw new Error("A history only accepts one active listener");
      }
      window2.addEventListener(PopStateEventType, handlePop);
      listener = fn;
      return () => {
        window2.removeEventListener(PopStateEventType, handlePop);
        listener = null;
      };
    },
    createHref(to) {
      return createHref(window2, to);
    },
    createURL,
    encodeLocation(to) {
      let url = createURL(to);
      return {
        pathname: url.pathname,
        search: url.search,
        hash: url.hash
      };
    },
    push,
    replace,
    go(n2) {
      return globalHistory.go(n2);
    }
  };
  return history;
}
var ResultType;
(function(ResultType2) {
  ResultType2["data"] = "data";
  ResultType2["deferred"] = "deferred";
  ResultType2["redirect"] = "redirect";
  ResultType2["error"] = "error";
})(ResultType || (ResultType = {}));
function matchRoutes(routes, locationArg, basename) {
  if (basename === void 0) {
    basename = "/";
  }
  return matchRoutesImpl(routes, locationArg, basename);
}
function matchRoutesImpl(routes, locationArg, basename, allowPartial) {
  let location2 = typeof locationArg === "string" ? parsePath(locationArg) : locationArg;
  let pathname = stripBasename(location2.pathname || "/", basename);
  if (pathname == null) {
    return null;
  }
  let branches = flattenRoutes(routes);
  rankRouteBranches(branches);
  let matches = null;
  for (let i = 0; matches == null && i < branches.length; ++i) {
    let decoded = decodePath(pathname);
    matches = matchRouteBranch(branches[i], decoded);
  }
  return matches;
}
function flattenRoutes(routes, branches, parentsMeta, parentPath) {
  if (branches === void 0) {
    branches = [];
  }
  if (parentsMeta === void 0) {
    parentsMeta = [];
  }
  if (parentPath === void 0) {
    parentPath = "";
  }
  let flattenRoute = (route, index, relativePath) => {
    let meta = {
      relativePath: relativePath === void 0 ? route.path || "" : relativePath,
      caseSensitive: route.caseSensitive === true,
      childrenIndex: index,
      route
    };
    if (meta.relativePath.startsWith("/")) {
      invariant(meta.relativePath.startsWith(parentPath), 'Absolute route path "' + meta.relativePath + '" nested under path ' + ('"' + parentPath + '" is not valid. An absolute child route path ') + "must start with the combined path of all its parent routes.");
      meta.relativePath = meta.relativePath.slice(parentPath.length);
    }
    let path2 = joinPaths([parentPath, meta.relativePath]);
    let routesMeta = parentsMeta.concat(meta);
    if (route.children && route.children.length > 0) {
      invariant(
        // Our types know better, but runtime JS may not!
        // @ts-expect-error
        route.index !== true,
        "Index routes must not have child routes. Please remove " + ('all child routes from route path "' + path2 + '".')
      );
      flattenRoutes(route.children, branches, routesMeta, path2);
    }
    if (route.path == null && !route.index) {
      return;
    }
    branches.push({
      path: path2,
      score: computeScore(path2, route.index),
      routesMeta
    });
  };
  routes.forEach((route, index) => {
    var _route$path;
    if (route.path === "" || !((_route$path = route.path) != null && _route$path.includes("?"))) {
      flattenRoute(route, index);
    } else {
      for (let exploded of explodeOptionalSegments(route.path)) {
        flattenRoute(route, index, exploded);
      }
    }
  });
  return branches;
}
function explodeOptionalSegments(path2) {
  let segments = path2.split("/");
  if (segments.length === 0) return [];
  let [first, ...rest] = segments;
  let isOptional = first.endsWith("?");
  let required = first.replace(/\?$/, "");
  if (rest.length === 0) {
    return isOptional ? [required, ""] : [required];
  }
  let restExploded = explodeOptionalSegments(rest.join("/"));
  let result = [];
  result.push(...restExploded.map((subpath) => subpath === "" ? required : [required, subpath].join("/")));
  if (isOptional) {
    result.push(...restExploded);
  }
  return result.map((exploded) => path2.startsWith("/") && exploded === "" ? "/" : exploded);
}
function rankRouteBranches(branches) {
  branches.sort((a, b) => a.score !== b.score ? b.score - a.score : compareIndexes(a.routesMeta.map((meta) => meta.childrenIndex), b.routesMeta.map((meta) => meta.childrenIndex)));
}
const paramRe = /^:[\w-]+$/;
const dynamicSegmentValue = 3;
const indexRouteValue = 2;
const emptySegmentValue = 1;
const staticSegmentValue = 10;
const splatPenalty = -2;
const isSplat = (s) => s === "*";
function computeScore(path2, index) {
  let segments = path2.split("/");
  let initialScore = segments.length;
  if (segments.some(isSplat)) {
    initialScore += splatPenalty;
  }
  if (index) {
    initialScore += indexRouteValue;
  }
  return segments.filter((s) => !isSplat(s)).reduce((score, segment) => score + (paramRe.test(segment) ? dynamicSegmentValue : segment === "" ? emptySegmentValue : staticSegmentValue), initialScore);
}
function compareIndexes(a, b) {
  let siblings = a.length === b.length && a.slice(0, -1).every((n2, i) => n2 === b[i]);
  return siblings ? (
    // If two routes are siblings, we should try to match the earlier sibling
    // first. This allows people to have fine-grained control over the matching
    // behavior by simply putting routes with identical paths in the order they
    // want them tried.
    a[a.length - 1] - b[b.length - 1]
  ) : (
    // Otherwise, it doesn't really make sense to rank non-siblings by index,
    // so they sort equally.
    0
  );
}
function matchRouteBranch(branch, pathname, allowPartial) {
  let {
    routesMeta
  } = branch;
  let matchedParams = {};
  let matchedPathname = "/";
  let matches = [];
  for (let i = 0; i < routesMeta.length; ++i) {
    let meta = routesMeta[i];
    let end = i === routesMeta.length - 1;
    let remainingPathname = matchedPathname === "/" ? pathname : pathname.slice(matchedPathname.length) || "/";
    let match = matchPath({
      path: meta.relativePath,
      caseSensitive: meta.caseSensitive,
      end
    }, remainingPathname);
    let route = meta.route;
    if (!match) {
      return null;
    }
    Object.assign(matchedParams, match.params);
    matches.push({
      // TODO: Can this as be avoided?
      params: matchedParams,
      pathname: joinPaths([matchedPathname, match.pathname]),
      pathnameBase: normalizePathname(joinPaths([matchedPathname, match.pathnameBase])),
      route
    });
    if (match.pathnameBase !== "/") {
      matchedPathname = joinPaths([matchedPathname, match.pathnameBase]);
    }
  }
  return matches;
}
function matchPath(pattern, pathname) {
  if (typeof pattern === "string") {
    pattern = {
      path: pattern,
      caseSensitive: false,
      end: true
    };
  }
  let [matcher, compiledParams] = compilePath(pattern.path, pattern.caseSensitive, pattern.end);
  let match = pathname.match(matcher);
  if (!match) return null;
  let matchedPathname = match[0];
  let pathnameBase = matchedPathname.replace(/(.)\/+$/, "$1");
  let captureGroups = match.slice(1);
  let params = compiledParams.reduce((memo, _ref, index) => {
    let {
      paramName,
      isOptional
    } = _ref;
    if (paramName === "*") {
      let splatValue = captureGroups[index] || "";
      pathnameBase = matchedPathname.slice(0, matchedPathname.length - splatValue.length).replace(/(.)\/+$/, "$1");
    }
    const value = captureGroups[index];
    if (isOptional && !value) {
      memo[paramName] = void 0;
    } else {
      memo[paramName] = (value || "").replace(/%2F/g, "/");
    }
    return memo;
  }, {});
  return {
    params,
    pathname: matchedPathname,
    pathnameBase,
    pattern
  };
}
function compilePath(path2, caseSensitive, end) {
  if (caseSensitive === void 0) {
    caseSensitive = false;
  }
  if (end === void 0) {
    end = true;
  }
  warning(path2 === "*" || !path2.endsWith("*") || path2.endsWith("/*"), 'Route path "' + path2 + '" will be treated as if it were ' + ('"' + path2.replace(/\*$/, "/*") + '" because the `*` character must ') + "always follow a `/` in the pattern. To get rid of this warning, " + ('please change the route path to "' + path2.replace(/\*$/, "/*") + '".'));
  let params = [];
  let regexpSource = "^" + path2.replace(/\/*\*?$/, "").replace(/^\/*/, "/").replace(/[\\.*+^${}|()[\]]/g, "\\$&").replace(/\/:([\w-]+)(\?)?/g, (_, paramName, isOptional) => {
    params.push({
      paramName,
      isOptional: isOptional != null
    });
    return isOptional ? "/?([^\\/]+)?" : "/([^\\/]+)";
  });
  if (path2.endsWith("*")) {
    params.push({
      paramName: "*"
    });
    regexpSource += path2 === "*" || path2 === "/*" ? "(.*)$" : "(?:\\/(.+)|\\/*)$";
  } else if (end) {
    regexpSource += "\\/*$";
  } else if (path2 !== "" && path2 !== "/") {
    regexpSource += "(?:(?=\\/|$))";
  } else ;
  let matcher = new RegExp(regexpSource, caseSensitive ? void 0 : "i");
  return [matcher, params];
}
function decodePath(value) {
  try {
    return value.split("/").map((v2) => decodeURIComponent(v2).replace(/\//g, "%2F")).join("/");
  } catch (error) {
    warning(false, 'The URL path "' + value + '" could not be decoded because it is is a malformed URL segment. This is probably due to a bad percent ' + ("encoding (" + error + ")."));
    return value;
  }
}
function stripBasename(pathname, basename) {
  if (basename === "/") return pathname;
  if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) {
    return null;
  }
  let startIndex = basename.endsWith("/") ? basename.length - 1 : basename.length;
  let nextChar = pathname.charAt(startIndex);
  if (nextChar && nextChar !== "/") {
    return null;
  }
  return pathname.slice(startIndex) || "/";
}
const ABSOLUTE_URL_REGEX$1 = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const isAbsoluteUrl = (url) => ABSOLUTE_URL_REGEX$1.test(url);
function resolvePath(to, fromPathname) {
  if (fromPathname === void 0) {
    fromPathname = "/";
  }
  let {
    pathname: toPathname,
    search = "",
    hash: hash2 = ""
  } = typeof to === "string" ? parsePath(to) : to;
  let pathname;
  if (toPathname) {
    if (isAbsoluteUrl(toPathname)) {
      pathname = toPathname;
    } else {
      if (toPathname.includes("//")) {
        let oldPathname = toPathname;
        toPathname = toPathname.replace(/\/\/+/g, "/");
        warning(false, "Pathnames cannot have embedded double slashes - normalizing " + (oldPathname + " -> " + toPathname));
      }
      if (toPathname.startsWith("/")) {
        pathname = resolvePathname(toPathname.substring(1), "/");
      } else {
        pathname = resolvePathname(toPathname, fromPathname);
      }
    }
  } else {
    pathname = fromPathname;
  }
  return {
    pathname,
    search: normalizeSearch(search),
    hash: normalizeHash(hash2)
  };
}
function resolvePathname(relativePath, fromPathname) {
  let segments = fromPathname.replace(/\/+$/, "").split("/");
  let relativeSegments = relativePath.split("/");
  relativeSegments.forEach((segment) => {
    if (segment === "..") {
      if (segments.length > 1) segments.pop();
    } else if (segment !== ".") {
      segments.push(segment);
    }
  });
  return segments.length > 1 ? segments.join("/") : "/";
}
function getInvalidPathError(char, field, dest, path2) {
  return "Cannot include a '" + char + "' character in a manually specified " + ("`to." + field + "` field [" + JSON.stringify(path2) + "].  Please separate it out to the ") + ("`to." + dest + "` field. Alternatively you may provide the full path as ") + 'a string in <Link to="..."> and the router will parse it for you.';
}
function getPathContributingMatches(matches) {
  return matches.filter((match, index) => index === 0 || match.route.path && match.route.path.length > 0);
}
function getResolveToMatches(matches, v7_relativeSplatPath) {
  let pathMatches = getPathContributingMatches(matches);
  if (v7_relativeSplatPath) {
    return pathMatches.map((match, idx) => idx === pathMatches.length - 1 ? match.pathname : match.pathnameBase);
  }
  return pathMatches.map((match) => match.pathnameBase);
}
function resolveTo(toArg, routePathnames, locationPathname, isPathRelative) {
  if (isPathRelative === void 0) {
    isPathRelative = false;
  }
  let to;
  if (typeof toArg === "string") {
    to = parsePath(toArg);
  } else {
    to = _extends$2({}, toArg);
    invariant(!to.pathname || !to.pathname.includes("?"), getInvalidPathError("?", "pathname", "search", to));
    invariant(!to.pathname || !to.pathname.includes("#"), getInvalidPathError("#", "pathname", "hash", to));
    invariant(!to.search || !to.search.includes("#"), getInvalidPathError("#", "search", "hash", to));
  }
  let isEmptyPath = toArg === "" || to.pathname === "";
  let toPathname = isEmptyPath ? "/" : to.pathname;
  let from;
  if (toPathname == null) {
    from = locationPathname;
  } else {
    let routePathnameIndex = routePathnames.length - 1;
    if (!isPathRelative && toPathname.startsWith("..")) {
      let toSegments = toPathname.split("/");
      while (toSegments[0] === "..") {
        toSegments.shift();
        routePathnameIndex -= 1;
      }
      to.pathname = toSegments.join("/");
    }
    from = routePathnameIndex >= 0 ? routePathnames[routePathnameIndex] : "/";
  }
  let path2 = resolvePath(to, from);
  let hasExplicitTrailingSlash = toPathname && toPathname !== "/" && toPathname.endsWith("/");
  let hasCurrentTrailingSlash = (isEmptyPath || toPathname === ".") && locationPathname.endsWith("/");
  if (!path2.pathname.endsWith("/") && (hasExplicitTrailingSlash || hasCurrentTrailingSlash)) {
    path2.pathname += "/";
  }
  return path2;
}
const joinPaths = (paths) => paths.join("/").replace(/\/\/+/g, "/");
const normalizePathname = (pathname) => pathname.replace(/\/+$/, "").replace(/^\/*/, "/");
const normalizeSearch = (search) => !search || search === "?" ? "" : search.startsWith("?") ? search : "?" + search;
const normalizeHash = (hash2) => !hash2 || hash2 === "#" ? "" : hash2.startsWith("#") ? hash2 : "#" + hash2;
function isRouteErrorResponse(error) {
  return error != null && typeof error.status === "number" && typeof error.statusText === "string" && typeof error.internal === "boolean" && "data" in error;
}
const validMutationMethodsArr = ["post", "put", "patch", "delete"];
new Set(validMutationMethodsArr);
const validRequestMethodsArr = ["get", ...validMutationMethodsArr];
new Set(validRequestMethodsArr);
/**
 * React Router v6.30.3
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */
function _extends$1() {
  _extends$1 = Object.assign ? Object.assign.bind() : function(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };
  return _extends$1.apply(this, arguments);
}
const DataRouterContext = /* @__PURE__ */ reactExports.createContext(null);
const DataRouterStateContext = /* @__PURE__ */ reactExports.createContext(null);
const NavigationContext = /* @__PURE__ */ reactExports.createContext(null);
const LocationContext = /* @__PURE__ */ reactExports.createContext(null);
const RouteContext = /* @__PURE__ */ reactExports.createContext({
  outlet: null,
  matches: [],
  isDataRoute: false
});
const RouteErrorContext = /* @__PURE__ */ reactExports.createContext(null);
function useHref(to, _temp) {
  let {
    relative
  } = _temp === void 0 ? {} : _temp;
  !useInRouterContext() ? invariant(false) : void 0;
  let {
    basename,
    navigator: navigator2
  } = reactExports.useContext(NavigationContext);
  let {
    hash: hash2,
    pathname,
    search
  } = useResolvedPath(to, {
    relative
  });
  let joinedPathname = pathname;
  if (basename !== "/") {
    joinedPathname = pathname === "/" ? basename : joinPaths([basename, pathname]);
  }
  return navigator2.createHref({
    pathname: joinedPathname,
    search,
    hash: hash2
  });
}
function useInRouterContext() {
  return reactExports.useContext(LocationContext) != null;
}
function useLocation() {
  !useInRouterContext() ? invariant(false) : void 0;
  return reactExports.useContext(LocationContext).location;
}
function useIsomorphicLayoutEffect$1(cb2) {
  let isStatic = reactExports.useContext(NavigationContext).static;
  if (!isStatic) {
    reactExports.useLayoutEffect(cb2);
  }
}
function useNavigate() {
  let {
    isDataRoute
  } = reactExports.useContext(RouteContext);
  return isDataRoute ? useNavigateStable() : useNavigateUnstable();
}
function useNavigateUnstable() {
  !useInRouterContext() ? invariant(false) : void 0;
  let dataRouterContext = reactExports.useContext(DataRouterContext);
  let {
    basename,
    future,
    navigator: navigator2
  } = reactExports.useContext(NavigationContext);
  let {
    matches
  } = reactExports.useContext(RouteContext);
  let {
    pathname: locationPathname
  } = useLocation();
  let routePathnamesJson = JSON.stringify(getResolveToMatches(matches, future.v7_relativeSplatPath));
  let activeRef = reactExports.useRef(false);
  useIsomorphicLayoutEffect$1(() => {
    activeRef.current = true;
  });
  let navigate = reactExports.useCallback(function(to, options) {
    if (options === void 0) {
      options = {};
    }
    if (!activeRef.current) return;
    if (typeof to === "number") {
      navigator2.go(to);
      return;
    }
    let path2 = resolveTo(to, JSON.parse(routePathnamesJson), locationPathname, options.relative === "path");
    if (dataRouterContext == null && basename !== "/") {
      path2.pathname = path2.pathname === "/" ? basename : joinPaths([basename, path2.pathname]);
    }
    (!!options.replace ? navigator2.replace : navigator2.push)(path2, options.state, options);
  }, [basename, navigator2, routePathnamesJson, locationPathname, dataRouterContext]);
  return navigate;
}
const OutletContext = /* @__PURE__ */ reactExports.createContext(null);
function useOutlet(context) {
  let outlet = reactExports.useContext(RouteContext).outlet;
  if (outlet) {
    return /* @__PURE__ */ reactExports.createElement(OutletContext.Provider, {
      value: context
    }, outlet);
  }
  return outlet;
}
function useResolvedPath(to, _temp2) {
  let {
    relative
  } = _temp2 === void 0 ? {} : _temp2;
  let {
    future
  } = reactExports.useContext(NavigationContext);
  let {
    matches
  } = reactExports.useContext(RouteContext);
  let {
    pathname: locationPathname
  } = useLocation();
  let routePathnamesJson = JSON.stringify(getResolveToMatches(matches, future.v7_relativeSplatPath));
  return reactExports.useMemo(() => resolveTo(to, JSON.parse(routePathnamesJson), locationPathname, relative === "path"), [to, routePathnamesJson, locationPathname, relative]);
}
function useRoutes(routes, locationArg) {
  return useRoutesImpl(routes, locationArg);
}
function useRoutesImpl(routes, locationArg, dataRouterState, future) {
  !useInRouterContext() ? invariant(false) : void 0;
  let {
    navigator: navigator2
  } = reactExports.useContext(NavigationContext);
  let {
    matches: parentMatches
  } = reactExports.useContext(RouteContext);
  let routeMatch = parentMatches[parentMatches.length - 1];
  let parentParams = routeMatch ? routeMatch.params : {};
  routeMatch ? routeMatch.pathname : "/";
  let parentPathnameBase = routeMatch ? routeMatch.pathnameBase : "/";
  routeMatch && routeMatch.route;
  let locationFromContext = useLocation();
  let location2;
  if (locationArg) {
    var _parsedLocationArg$pa;
    let parsedLocationArg = typeof locationArg === "string" ? parsePath(locationArg) : locationArg;
    !(parentPathnameBase === "/" || ((_parsedLocationArg$pa = parsedLocationArg.pathname) == null ? void 0 : _parsedLocationArg$pa.startsWith(parentPathnameBase))) ? invariant(false) : void 0;
    location2 = parsedLocationArg;
  } else {
    location2 = locationFromContext;
  }
  let pathname = location2.pathname || "/";
  let remainingPathname = pathname;
  if (parentPathnameBase !== "/") {
    let parentSegments = parentPathnameBase.replace(/^\//, "").split("/");
    let segments = pathname.replace(/^\//, "").split("/");
    remainingPathname = "/" + segments.slice(parentSegments.length).join("/");
  }
  let matches = matchRoutes(routes, {
    pathname: remainingPathname
  });
  let renderedMatches = _renderMatches(matches && matches.map((match) => Object.assign({}, match, {
    params: Object.assign({}, parentParams, match.params),
    pathname: joinPaths([
      parentPathnameBase,
      // Re-encode pathnames that were decoded inside matchRoutes
      navigator2.encodeLocation ? navigator2.encodeLocation(match.pathname).pathname : match.pathname
    ]),
    pathnameBase: match.pathnameBase === "/" ? parentPathnameBase : joinPaths([
      parentPathnameBase,
      // Re-encode pathnames that were decoded inside matchRoutes
      navigator2.encodeLocation ? navigator2.encodeLocation(match.pathnameBase).pathname : match.pathnameBase
    ])
  })), parentMatches, dataRouterState, future);
  if (locationArg && renderedMatches) {
    return /* @__PURE__ */ reactExports.createElement(LocationContext.Provider, {
      value: {
        location: _extends$1({
          pathname: "/",
          search: "",
          hash: "",
          state: null,
          key: "default"
        }, location2),
        navigationType: Action$1.Pop
      }
    }, renderedMatches);
  }
  return renderedMatches;
}
function DefaultErrorComponent() {
  let error = useRouteError();
  let message = isRouteErrorResponse(error) ? error.status + " " + error.statusText : error instanceof Error ? error.message : JSON.stringify(error);
  let stack = error instanceof Error ? error.stack : null;
  let lightgrey = "rgba(200,200,200, 0.5)";
  let preStyles = {
    padding: "0.5rem",
    backgroundColor: lightgrey
  };
  let devInfo = null;
  return /* @__PURE__ */ reactExports.createElement(reactExports.Fragment, null, /* @__PURE__ */ reactExports.createElement("h2", null, "Unexpected Application Error!"), /* @__PURE__ */ reactExports.createElement("h3", {
    style: {
      fontStyle: "italic"
    }
  }, message), stack ? /* @__PURE__ */ reactExports.createElement("pre", {
    style: preStyles
  }, stack) : null, devInfo);
}
const defaultErrorElement = /* @__PURE__ */ reactExports.createElement(DefaultErrorComponent, null);
class RenderErrorBoundary extends reactExports.Component {
  constructor(props) {
    super(props);
    this.state = {
      location: props.location,
      revalidation: props.revalidation,
      error: props.error
    };
  }
  static getDerivedStateFromError(error) {
    return {
      error
    };
  }
  static getDerivedStateFromProps(props, state) {
    if (state.location !== props.location || state.revalidation !== "idle" && props.revalidation === "idle") {
      return {
        error: props.error,
        location: props.location,
        revalidation: props.revalidation
      };
    }
    return {
      error: props.error !== void 0 ? props.error : state.error,
      location: state.location,
      revalidation: props.revalidation || state.revalidation
    };
  }
  componentDidCatch(error, errorInfo) {
    console.error("React Router caught the following error during render", error, errorInfo);
  }
  render() {
    return this.state.error !== void 0 ? /* @__PURE__ */ reactExports.createElement(RouteContext.Provider, {
      value: this.props.routeContext
    }, /* @__PURE__ */ reactExports.createElement(RouteErrorContext.Provider, {
      value: this.state.error,
      children: this.props.component
    })) : this.props.children;
  }
}
function RenderedRoute(_ref) {
  let {
    routeContext,
    match,
    children
  } = _ref;
  let dataRouterContext = reactExports.useContext(DataRouterContext);
  if (dataRouterContext && dataRouterContext.static && dataRouterContext.staticContext && (match.route.errorElement || match.route.ErrorBoundary)) {
    dataRouterContext.staticContext._deepestRenderedBoundaryId = match.route.id;
  }
  return /* @__PURE__ */ reactExports.createElement(RouteContext.Provider, {
    value: routeContext
  }, children);
}
function _renderMatches(matches, parentMatches, dataRouterState, future) {
  var _dataRouterState;
  if (parentMatches === void 0) {
    parentMatches = [];
  }
  if (dataRouterState === void 0) {
    dataRouterState = null;
  }
  if (future === void 0) {
    future = null;
  }
  if (matches == null) {
    var _future;
    if (!dataRouterState) {
      return null;
    }
    if (dataRouterState.errors) {
      matches = dataRouterState.matches;
    } else if ((_future = future) != null && _future.v7_partialHydration && parentMatches.length === 0 && !dataRouterState.initialized && dataRouterState.matches.length > 0) {
      matches = dataRouterState.matches;
    } else {
      return null;
    }
  }
  let renderedMatches = matches;
  let errors = (_dataRouterState = dataRouterState) == null ? void 0 : _dataRouterState.errors;
  if (errors != null) {
    let errorIndex = renderedMatches.findIndex((m2) => m2.route.id && (errors == null ? void 0 : errors[m2.route.id]) !== void 0);
    !(errorIndex >= 0) ? invariant(false) : void 0;
    renderedMatches = renderedMatches.slice(0, Math.min(renderedMatches.length, errorIndex + 1));
  }
  let renderFallback = false;
  let fallbackIndex = -1;
  if (dataRouterState && future && future.v7_partialHydration) {
    for (let i = 0; i < renderedMatches.length; i++) {
      let match = renderedMatches[i];
      if (match.route.HydrateFallback || match.route.hydrateFallbackElement) {
        fallbackIndex = i;
      }
      if (match.route.id) {
        let {
          loaderData,
          errors: errors2
        } = dataRouterState;
        let needsToRunLoader = match.route.loader && loaderData[match.route.id] === void 0 && (!errors2 || errors2[match.route.id] === void 0);
        if (match.route.lazy || needsToRunLoader) {
          renderFallback = true;
          if (fallbackIndex >= 0) {
            renderedMatches = renderedMatches.slice(0, fallbackIndex + 1);
          } else {
            renderedMatches = [renderedMatches[0]];
          }
          break;
        }
      }
    }
  }
  return renderedMatches.reduceRight((outlet, match, index) => {
    let error;
    let shouldRenderHydrateFallback = false;
    let errorElement = null;
    let hydrateFallbackElement = null;
    if (dataRouterState) {
      error = errors && match.route.id ? errors[match.route.id] : void 0;
      errorElement = match.route.errorElement || defaultErrorElement;
      if (renderFallback) {
        if (fallbackIndex < 0 && index === 0) {
          warningOnce("route-fallback");
          shouldRenderHydrateFallback = true;
          hydrateFallbackElement = null;
        } else if (fallbackIndex === index) {
          shouldRenderHydrateFallback = true;
          hydrateFallbackElement = match.route.hydrateFallbackElement || null;
        }
      }
    }
    let matches2 = parentMatches.concat(renderedMatches.slice(0, index + 1));
    let getChildren = () => {
      let children;
      if (error) {
        children = errorElement;
      } else if (shouldRenderHydrateFallback) {
        children = hydrateFallbackElement;
      } else if (match.route.Component) {
        children = /* @__PURE__ */ reactExports.createElement(match.route.Component, null);
      } else if (match.route.element) {
        children = match.route.element;
      } else {
        children = outlet;
      }
      return /* @__PURE__ */ reactExports.createElement(RenderedRoute, {
        match,
        routeContext: {
          outlet,
          matches: matches2,
          isDataRoute: dataRouterState != null
        },
        children
      });
    };
    return dataRouterState && (match.route.ErrorBoundary || match.route.errorElement || index === 0) ? /* @__PURE__ */ reactExports.createElement(RenderErrorBoundary, {
      location: dataRouterState.location,
      revalidation: dataRouterState.revalidation,
      component: errorElement,
      error,
      children: getChildren(),
      routeContext: {
        outlet: null,
        matches: matches2,
        isDataRoute: true
      }
    }) : getChildren();
  }, null);
}
var DataRouterHook$1 = /* @__PURE__ */ function(DataRouterHook2) {
  DataRouterHook2["UseBlocker"] = "useBlocker";
  DataRouterHook2["UseRevalidator"] = "useRevalidator";
  DataRouterHook2["UseNavigateStable"] = "useNavigate";
  return DataRouterHook2;
}(DataRouterHook$1 || {});
var DataRouterStateHook$1 = /* @__PURE__ */ function(DataRouterStateHook2) {
  DataRouterStateHook2["UseBlocker"] = "useBlocker";
  DataRouterStateHook2["UseLoaderData"] = "useLoaderData";
  DataRouterStateHook2["UseActionData"] = "useActionData";
  DataRouterStateHook2["UseRouteError"] = "useRouteError";
  DataRouterStateHook2["UseNavigation"] = "useNavigation";
  DataRouterStateHook2["UseRouteLoaderData"] = "useRouteLoaderData";
  DataRouterStateHook2["UseMatches"] = "useMatches";
  DataRouterStateHook2["UseRevalidator"] = "useRevalidator";
  DataRouterStateHook2["UseNavigateStable"] = "useNavigate";
  DataRouterStateHook2["UseRouteId"] = "useRouteId";
  return DataRouterStateHook2;
}(DataRouterStateHook$1 || {});
function useDataRouterContext$1(hookName) {
  let ctx = reactExports.useContext(DataRouterContext);
  !ctx ? invariant(false) : void 0;
  return ctx;
}
function useDataRouterState(hookName) {
  let state = reactExports.useContext(DataRouterStateContext);
  !state ? invariant(false) : void 0;
  return state;
}
function useRouteContext(hookName) {
  let route = reactExports.useContext(RouteContext);
  !route ? invariant(false) : void 0;
  return route;
}
function useCurrentRouteId(hookName) {
  let route = useRouteContext();
  let thisRoute = route.matches[route.matches.length - 1];
  !thisRoute.route.id ? invariant(false) : void 0;
  return thisRoute.route.id;
}
function useRouteError() {
  var _state$errors;
  let error = reactExports.useContext(RouteErrorContext);
  let state = useDataRouterState();
  let routeId = useCurrentRouteId();
  if (error !== void 0) {
    return error;
  }
  return (_state$errors = state.errors) == null ? void 0 : _state$errors[routeId];
}
function useNavigateStable() {
  let {
    router
  } = useDataRouterContext$1(DataRouterHook$1.UseNavigateStable);
  let id2 = useCurrentRouteId(DataRouterStateHook$1.UseNavigateStable);
  let activeRef = reactExports.useRef(false);
  useIsomorphicLayoutEffect$1(() => {
    activeRef.current = true;
  });
  let navigate = reactExports.useCallback(function(to, options) {
    if (options === void 0) {
      options = {};
    }
    if (!activeRef.current) return;
    if (typeof to === "number") {
      router.navigate(to);
    } else {
      router.navigate(to, _extends$1({
        fromRouteId: id2
      }, options));
    }
  }, [router, id2]);
  return navigate;
}
const alreadyWarned$1 = {};
function warningOnce(key, cond, message) {
  if (!alreadyWarned$1[key]) {
    alreadyWarned$1[key] = true;
  }
}
function logV6DeprecationWarnings(renderFuture, routerFuture) {
  if ((renderFuture == null ? void 0 : renderFuture.v7_startTransition) === void 0) ;
  if ((renderFuture == null ? void 0 : renderFuture.v7_relativeSplatPath) === void 0 && true) ;
}
function Navigate(_ref4) {
  let {
    to,
    replace: replace2,
    state,
    relative
  } = _ref4;
  !useInRouterContext() ? invariant(false) : void 0;
  let {
    future,
    static: isStatic
  } = reactExports.useContext(NavigationContext);
  let {
    matches
  } = reactExports.useContext(RouteContext);
  let {
    pathname: locationPathname
  } = useLocation();
  let navigate = useNavigate();
  let path2 = resolveTo(to, getResolveToMatches(matches, future.v7_relativeSplatPath), locationPathname, relative === "path");
  let jsonPath = JSON.stringify(path2);
  reactExports.useEffect(() => navigate(JSON.parse(jsonPath), {
    replace: replace2,
    state,
    relative
  }), [navigate, jsonPath, relative, replace2, state]);
  return null;
}
function Outlet(props) {
  return useOutlet(props.context);
}
function Route(_props) {
  invariant(false);
}
function Router(_ref5) {
  let {
    basename: basenameProp = "/",
    children = null,
    location: locationProp,
    navigationType = Action$1.Pop,
    navigator: navigator2,
    static: staticProp = false,
    future
  } = _ref5;
  !!useInRouterContext() ? invariant(false) : void 0;
  let basename = basenameProp.replace(/^\/*/, "/");
  let navigationContext = reactExports.useMemo(() => ({
    basename,
    navigator: navigator2,
    static: staticProp,
    future: _extends$1({
      v7_relativeSplatPath: false
    }, future)
  }), [basename, future, navigator2, staticProp]);
  if (typeof locationProp === "string") {
    locationProp = parsePath(locationProp);
  }
  let {
    pathname = "/",
    search = "",
    hash: hash2 = "",
    state = null,
    key = "default"
  } = locationProp;
  let locationContext = reactExports.useMemo(() => {
    let trailingPathname = stripBasename(pathname, basename);
    if (trailingPathname == null) {
      return null;
    }
    return {
      location: {
        pathname: trailingPathname,
        search,
        hash: hash2,
        state,
        key
      },
      navigationType
    };
  }, [basename, pathname, search, hash2, state, key, navigationType]);
  if (locationContext == null) {
    return null;
  }
  return /* @__PURE__ */ reactExports.createElement(NavigationContext.Provider, {
    value: navigationContext
  }, /* @__PURE__ */ reactExports.createElement(LocationContext.Provider, {
    children,
    value: locationContext
  }));
}
function Routes(_ref6) {
  let {
    children,
    location: location2
  } = _ref6;
  return useRoutes(createRoutesFromChildren(children), location2);
}
new Promise(() => {
});
function createRoutesFromChildren(children, parentPath) {
  if (parentPath === void 0) {
    parentPath = [];
  }
  let routes = [];
  reactExports.Children.forEach(children, (element, index) => {
    if (!/* @__PURE__ */ reactExports.isValidElement(element)) {
      return;
    }
    let treePath = [...parentPath, index];
    if (element.type === reactExports.Fragment) {
      routes.push.apply(routes, createRoutesFromChildren(element.props.children, treePath));
      return;
    }
    !(element.type === Route) ? invariant(false) : void 0;
    !(!element.props.index || !element.props.children) ? invariant(false) : void 0;
    let route = {
      id: element.props.id || treePath.join("-"),
      caseSensitive: element.props.caseSensitive,
      element: element.props.element,
      Component: element.props.Component,
      index: element.props.index,
      path: element.props.path,
      loader: element.props.loader,
      action: element.props.action,
      errorElement: element.props.errorElement,
      ErrorBoundary: element.props.ErrorBoundary,
      hasErrorBoundary: element.props.ErrorBoundary != null || element.props.errorElement != null,
      shouldRevalidate: element.props.shouldRevalidate,
      handle: element.props.handle,
      lazy: element.props.lazy
    };
    if (element.props.children) {
      route.children = createRoutesFromChildren(element.props.children, treePath);
    }
    routes.push(route);
  });
  return routes;
}
/**
 * React Router DOM v6.30.3
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */
function _extends() {
  _extends = Object.assign ? Object.assign.bind() : function(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };
  return _extends.apply(this, arguments);
}
function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;
  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }
  return target;
}
function isModifiedEvent(event) {
  return !!(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}
function shouldProcessLinkClick(event, target) {
  return event.button === 0 && // Ignore everything but left clicks
  (!target || target === "_self") && // Let browser handle "target=_blank" etc.
  !isModifiedEvent(event);
}
function createSearchParams(init) {
  if (init === void 0) {
    init = "";
  }
  return new URLSearchParams(typeof init === "string" || Array.isArray(init) || init instanceof URLSearchParams ? init : Object.keys(init).reduce((memo, key) => {
    let value = init[key];
    return memo.concat(Array.isArray(value) ? value.map((v2) => [key, v2]) : [[key, value]]);
  }, []));
}
function getSearchParamsForLocation(locationSearch, defaultSearchParams) {
  let searchParams = createSearchParams(locationSearch);
  if (defaultSearchParams) {
    defaultSearchParams.forEach((_, key) => {
      if (!searchParams.has(key)) {
        defaultSearchParams.getAll(key).forEach((value) => {
          searchParams.append(key, value);
        });
      }
    });
  }
  return searchParams;
}
const _excluded = ["onClick", "relative", "reloadDocument", "replace", "state", "target", "to", "preventScrollReset", "viewTransition"], _excluded2 = ["aria-current", "caseSensitive", "className", "end", "style", "to", "viewTransition", "children"];
const REACT_ROUTER_VERSION = "6";
try {
  window.__reactRouterVersion = REACT_ROUTER_VERSION;
} catch (e) {
}
const ViewTransitionContext = /* @__PURE__ */ reactExports.createContext({
  isTransitioning: false
});
const START_TRANSITION = "startTransition";
const startTransitionImpl = React$2[START_TRANSITION];
function HashRouter(_ref5) {
  let {
    basename,
    children,
    future,
    window: window2
  } = _ref5;
  let historyRef = reactExports.useRef();
  if (historyRef.current == null) {
    historyRef.current = createHashHistory({
      window: window2,
      v5Compat: true
    });
  }
  let history = historyRef.current;
  let [state, setStateImpl] = reactExports.useState({
    action: history.action,
    location: history.location
  });
  let {
    v7_startTransition
  } = future || {};
  let setState = reactExports.useCallback((newState) => {
    v7_startTransition && startTransitionImpl ? startTransitionImpl(() => setStateImpl(newState)) : setStateImpl(newState);
  }, [setStateImpl, v7_startTransition]);
  reactExports.useLayoutEffect(() => history.listen(setState), [history, setState]);
  reactExports.useEffect(() => logV6DeprecationWarnings(future), [future]);
  return /* @__PURE__ */ reactExports.createElement(Router, {
    basename,
    children,
    location: state.location,
    navigationType: state.action,
    navigator: history,
    future
  });
}
const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined" && typeof window.document.createElement !== "undefined";
const ABSOLUTE_URL_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const Link = /* @__PURE__ */ reactExports.forwardRef(function LinkWithRef(_ref7, ref) {
  let {
    onClick,
    relative,
    reloadDocument,
    replace: replace2,
    state,
    target,
    to,
    preventScrollReset,
    viewTransition
  } = _ref7, rest = _objectWithoutPropertiesLoose(_ref7, _excluded);
  let {
    basename
  } = reactExports.useContext(NavigationContext);
  let absoluteHref;
  let isExternal = false;
  if (typeof to === "string" && ABSOLUTE_URL_REGEX.test(to)) {
    absoluteHref = to;
    if (isBrowser) {
      try {
        let currentUrl = new URL(window.location.href);
        let targetUrl = to.startsWith("//") ? new URL(currentUrl.protocol + to) : new URL(to);
        let path2 = stripBasename(targetUrl.pathname, basename);
        if (targetUrl.origin === currentUrl.origin && path2 != null) {
          to = path2 + targetUrl.search + targetUrl.hash;
        } else {
          isExternal = true;
        }
      } catch (e) {
      }
    }
  }
  let href = useHref(to, {
    relative
  });
  let internalOnClick = useLinkClickHandler(to, {
    replace: replace2,
    state,
    target,
    preventScrollReset,
    relative,
    viewTransition
  });
  function handleClick(event) {
    if (onClick) onClick(event);
    if (!event.defaultPrevented) {
      internalOnClick(event);
    }
  }
  return (
    // eslint-disable-next-line jsx-a11y/anchor-has-content
    /* @__PURE__ */ reactExports.createElement("a", _extends({}, rest, {
      href: absoluteHref || href,
      onClick: isExternal || reloadDocument ? onClick : handleClick,
      ref,
      target
    }))
  );
});
const NavLink = /* @__PURE__ */ reactExports.forwardRef(function NavLinkWithRef(_ref8, ref) {
  let {
    "aria-current": ariaCurrentProp = "page",
    caseSensitive = false,
    className: classNameProp = "",
    end = false,
    style: styleProp,
    to,
    viewTransition,
    children
  } = _ref8, rest = _objectWithoutPropertiesLoose(_ref8, _excluded2);
  let path2 = useResolvedPath(to, {
    relative: rest.relative
  });
  let location2 = useLocation();
  let routerState = reactExports.useContext(DataRouterStateContext);
  let {
    navigator: navigator2,
    basename
  } = reactExports.useContext(NavigationContext);
  let isTransitioning = routerState != null && // Conditional usage is OK here because the usage of a data router is static
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useViewTransitionState(path2) && viewTransition === true;
  let toPathname = navigator2.encodeLocation ? navigator2.encodeLocation(path2).pathname : path2.pathname;
  let locationPathname = location2.pathname;
  let nextLocationPathname = routerState && routerState.navigation && routerState.navigation.location ? routerState.navigation.location.pathname : null;
  if (!caseSensitive) {
    locationPathname = locationPathname.toLowerCase();
    nextLocationPathname = nextLocationPathname ? nextLocationPathname.toLowerCase() : null;
    toPathname = toPathname.toLowerCase();
  }
  if (nextLocationPathname && basename) {
    nextLocationPathname = stripBasename(nextLocationPathname, basename) || nextLocationPathname;
  }
  const endSlashPosition = toPathname !== "/" && toPathname.endsWith("/") ? toPathname.length - 1 : toPathname.length;
  let isActive = locationPathname === toPathname || !end && locationPathname.startsWith(toPathname) && locationPathname.charAt(endSlashPosition) === "/";
  let isPending = nextLocationPathname != null && (nextLocationPathname === toPathname || !end && nextLocationPathname.startsWith(toPathname) && nextLocationPathname.charAt(toPathname.length) === "/");
  let renderProps = {
    isActive,
    isPending,
    isTransitioning
  };
  let ariaCurrent = isActive ? ariaCurrentProp : void 0;
  let className;
  if (typeof classNameProp === "function") {
    className = classNameProp(renderProps);
  } else {
    className = [classNameProp, isActive ? "active" : null, isPending ? "pending" : null, isTransitioning ? "transitioning" : null].filter(Boolean).join(" ");
  }
  let style = typeof styleProp === "function" ? styleProp(renderProps) : styleProp;
  return /* @__PURE__ */ reactExports.createElement(Link, _extends({}, rest, {
    "aria-current": ariaCurrent,
    className,
    ref,
    style,
    to,
    viewTransition
  }), typeof children === "function" ? children(renderProps) : children);
});
var DataRouterHook;
(function(DataRouterHook2) {
  DataRouterHook2["UseScrollRestoration"] = "useScrollRestoration";
  DataRouterHook2["UseSubmit"] = "useSubmit";
  DataRouterHook2["UseSubmitFetcher"] = "useSubmitFetcher";
  DataRouterHook2["UseFetcher"] = "useFetcher";
  DataRouterHook2["useViewTransitionState"] = "useViewTransitionState";
})(DataRouterHook || (DataRouterHook = {}));
var DataRouterStateHook;
(function(DataRouterStateHook2) {
  DataRouterStateHook2["UseFetcher"] = "useFetcher";
  DataRouterStateHook2["UseFetchers"] = "useFetchers";
  DataRouterStateHook2["UseScrollRestoration"] = "useScrollRestoration";
})(DataRouterStateHook || (DataRouterStateHook = {}));
function useDataRouterContext(hookName) {
  let ctx = reactExports.useContext(DataRouterContext);
  !ctx ? invariant(false) : void 0;
  return ctx;
}
function useLinkClickHandler(to, _temp) {
  let {
    target,
    replace: replaceProp,
    state,
    preventScrollReset,
    relative,
    viewTransition
  } = _temp === void 0 ? {} : _temp;
  let navigate = useNavigate();
  let location2 = useLocation();
  let path2 = useResolvedPath(to, {
    relative
  });
  return reactExports.useCallback((event) => {
    if (shouldProcessLinkClick(event, target)) {
      event.preventDefault();
      let replace2 = replaceProp !== void 0 ? replaceProp : createPath(location2) === createPath(path2);
      navigate(to, {
        replace: replace2,
        state,
        preventScrollReset,
        relative,
        viewTransition
      });
    }
  }, [location2, navigate, path2, replaceProp, state, target, to, preventScrollReset, relative, viewTransition]);
}
function useSearchParams(defaultInit) {
  let defaultSearchParamsRef = reactExports.useRef(createSearchParams(defaultInit));
  let hasSetSearchParamsRef = reactExports.useRef(false);
  let location2 = useLocation();
  let searchParams = reactExports.useMemo(() => (
    // Only merge in the defaults if we haven't yet called setSearchParams.
    // Once we call that we want those to take precedence, otherwise you can't
    // remove a param with setSearchParams({}) if it has an initial value
    getSearchParamsForLocation(location2.search, hasSetSearchParamsRef.current ? null : defaultSearchParamsRef.current)
  ), [location2.search]);
  let navigate = useNavigate();
  let setSearchParams = reactExports.useCallback((nextInit, navigateOptions) => {
    const newSearchParams = createSearchParams(typeof nextInit === "function" ? nextInit(searchParams) : nextInit);
    hasSetSearchParamsRef.current = true;
    navigate("?" + newSearchParams, navigateOptions);
  }, [navigate, searchParams]);
  return [searchParams, setSearchParams];
}
function useViewTransitionState(to, opts) {
  if (opts === void 0) {
    opts = {};
  }
  let vtContext = reactExports.useContext(ViewTransitionContext);
  !(vtContext != null) ? invariant(false) : void 0;
  let {
    basename
  } = useDataRouterContext(DataRouterHook.useViewTransitionState);
  let path2 = useResolvedPath(to, {
    relative: opts.relative
  });
  if (!vtContext.isTransitioning) {
    return false;
  }
  let currentPath = stripBasename(vtContext.currentLocation.pathname, basename) || vtContext.currentLocation.pathname;
  let nextPath = stripBasename(vtContext.nextLocation.pathname, basename) || vtContext.nextLocation.pathname;
  return matchPath(path2.pathname, nextPath) != null || matchPath(path2.pathname, currentPath) != null;
}
const scriptRel = function detectScriptRel() {
  const relList = typeof document !== "undefined" && document.createElement("link").relList;
  return relList && relList.supports && relList.supports("modulepreload") ? "modulepreload" : "preload";
}();
const assetsURL = function(dep, importerUrl) {
  return new URL(dep, importerUrl).href;
};
const seen = {};
const __vitePreload = function preload(baseModule, deps, importerUrl) {
  let promise = Promise.resolve();
  if (deps && deps.length > 0) {
    const links = document.getElementsByTagName("link");
    const cspNonceMeta = document.querySelector(
      "meta[property=csp-nonce]"
    );
    const cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute("nonce");
    promise = Promise.allSettled(
      deps.map((dep) => {
        dep = assetsURL(dep, importerUrl);
        if (dep in seen) return;
        seen[dep] = true;
        const isCss = dep.endsWith(".css");
        const cssSelector = isCss ? '[rel="stylesheet"]' : "";
        const isBaseRelative = !!importerUrl;
        if (isBaseRelative) {
          for (let i = links.length - 1; i >= 0; i--) {
            const link2 = links[i];
            if (link2.href === dep && (!isCss || link2.rel === "stylesheet")) {
              return;
            }
          }
        } else if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) {
          return;
        }
        const link = document.createElement("link");
        link.rel = isCss ? "stylesheet" : scriptRel;
        if (!isCss) {
          link.as = "script";
        }
        link.crossOrigin = "";
        link.href = dep;
        if (cspNonce) {
          link.setAttribute("nonce", cspNonce);
        }
        document.head.appendChild(link);
        if (isCss) {
          return new Promise((res, rej) => {
            link.addEventListener("load", res);
            link.addEventListener(
              "error",
              () => rej(new Error(`Unable to preload CSS for ${dep}`))
            );
          });
        }
      })
    );
  }
  function handlePreloadError(err) {
    const e = new Event("vite:preloadError", {
      cancelable: true
    });
    e.payload = err;
    window.dispatchEvent(e);
    if (!e.defaultPrevented) {
      throw err;
    }
  }
  return promise.then((res) => {
    for (const item of res || []) {
      if (item.status !== "rejected") continue;
      handlePreloadError(item.reason);
    }
    return baseModule().catch(handlePreloadError);
  });
};
const isString$1 = (obj) => typeof obj === "string";
const defer = () => {
  let res;
  let rej;
  const promise = new Promise((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  promise.resolve = res;
  promise.reject = rej;
  return promise;
};
const makeString = (object) => {
  if (object == null) return "";
  return "" + object;
};
const copy = (a, s, t2) => {
  a.forEach((m2) => {
    if (s[m2]) t2[m2] = s[m2];
  });
};
const lastOfPathSeparatorRegExp = /###/g;
const cleanKey = (key) => key && key.indexOf("###") > -1 ? key.replace(lastOfPathSeparatorRegExp, ".") : key;
const canNotTraverseDeeper = (object) => !object || isString$1(object);
const getLastOfPath = (object, path2, Empty) => {
  const stack = !isString$1(path2) ? path2 : path2.split(".");
  let stackIndex = 0;
  while (stackIndex < stack.length - 1) {
    if (canNotTraverseDeeper(object)) return {};
    const key = cleanKey(stack[stackIndex]);
    if (!object[key] && Empty) object[key] = new Empty();
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      object = object[key];
    } else {
      object = {};
    }
    ++stackIndex;
  }
  if (canNotTraverseDeeper(object)) return {};
  return {
    obj: object,
    k: cleanKey(stack[stackIndex])
  };
};
const setPath = (object, path2, newValue) => {
  const {
    obj,
    k: k2
  } = getLastOfPath(object, path2, Object);
  if (obj !== void 0 || path2.length === 1) {
    obj[k2] = newValue;
    return;
  }
  let e = path2[path2.length - 1];
  let p2 = path2.slice(0, path2.length - 1);
  let last = getLastOfPath(object, p2, Object);
  while (last.obj === void 0 && p2.length) {
    e = `${p2[p2.length - 1]}.${e}`;
    p2 = p2.slice(0, p2.length - 1);
    last = getLastOfPath(object, p2, Object);
    if (last?.obj && typeof last.obj[`${last.k}.${e}`] !== "undefined") {
      last.obj = void 0;
    }
  }
  last.obj[`${last.k}.${e}`] = newValue;
};
const pushPath = (object, path2, newValue, concat) => {
  const {
    obj,
    k: k2
  } = getLastOfPath(object, path2, Object);
  obj[k2] = obj[k2] || [];
  obj[k2].push(newValue);
};
const getPath = (object, path2) => {
  const {
    obj,
    k: k2
  } = getLastOfPath(object, path2);
  if (!obj) return void 0;
  if (!Object.prototype.hasOwnProperty.call(obj, k2)) return void 0;
  return obj[k2];
};
const getPathWithDefaults = (data, defaultData, key) => {
  const value = getPath(data, key);
  if (value !== void 0) {
    return value;
  }
  return getPath(defaultData, key);
};
const deepExtend = (target, source, overwrite) => {
  for (const prop in source) {
    if (prop !== "__proto__" && prop !== "constructor") {
      if (prop in target) {
        if (isString$1(target[prop]) || target[prop] instanceof String || isString$1(source[prop]) || source[prop] instanceof String) {
          if (overwrite) target[prop] = source[prop];
        } else {
          deepExtend(target[prop], source[prop], overwrite);
        }
      } else {
        target[prop] = source[prop];
      }
    }
  }
  return target;
};
const regexEscape = (str) => str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
var _entityMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;"
};
const escape = (data) => {
  if (isString$1(data)) {
    return data.replace(/[&<>"'\/]/g, (s) => _entityMap[s]);
  }
  return data;
};
class RegExpCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.regExpMap = /* @__PURE__ */ new Map();
    this.regExpQueue = [];
  }
  getRegExp(pattern) {
    const regExpFromCache = this.regExpMap.get(pattern);
    if (regExpFromCache !== void 0) {
      return regExpFromCache;
    }
    const regExpNew = new RegExp(pattern);
    if (this.regExpQueue.length === this.capacity) {
      this.regExpMap.delete(this.regExpQueue.shift());
    }
    this.regExpMap.set(pattern, regExpNew);
    this.regExpQueue.push(pattern);
    return regExpNew;
  }
}
const chars = [" ", ",", "?", "!", ";"];
const looksLikeObjectPathRegExpCache = new RegExpCache(20);
const looksLikeObjectPath = (key, nsSeparator, keySeparator) => {
  nsSeparator = nsSeparator || "";
  keySeparator = keySeparator || "";
  const possibleChars = chars.filter((c) => nsSeparator.indexOf(c) < 0 && keySeparator.indexOf(c) < 0);
  if (possibleChars.length === 0) return true;
  const r2 = looksLikeObjectPathRegExpCache.getRegExp(`(${possibleChars.map((c) => c === "?" ? "\\?" : c).join("|")})`);
  let matched = !r2.test(key);
  if (!matched) {
    const ki2 = key.indexOf(keySeparator);
    if (ki2 > 0 && !r2.test(key.substring(0, ki2))) {
      matched = true;
    }
  }
  return matched;
};
const deepFind = (obj, path2, keySeparator = ".") => {
  if (!obj) return void 0;
  if (obj[path2]) {
    if (!Object.prototype.hasOwnProperty.call(obj, path2)) return void 0;
    return obj[path2];
  }
  const tokens = path2.split(keySeparator);
  let current = obj;
  for (let i = 0; i < tokens.length; ) {
    if (!current || typeof current !== "object") {
      return void 0;
    }
    let next;
    let nextPath = "";
    for (let j = i; j < tokens.length; ++j) {
      if (j !== i) {
        nextPath += keySeparator;
      }
      nextPath += tokens[j];
      next = current[nextPath];
      if (next !== void 0) {
        if (["string", "number", "boolean"].indexOf(typeof next) > -1 && j < tokens.length - 1) {
          continue;
        }
        i += j - i + 1;
        break;
      }
    }
    current = next;
  }
  return current;
};
const getCleanedCode = (code) => code?.replace("_", "-");
const consoleLogger = {
  type: "logger",
  log(args) {
    this.output("log", args);
  },
  warn(args) {
    this.output("warn", args);
  },
  error(args) {
    this.output("error", args);
  },
  output(type, args) {
    console?.[type]?.apply?.(console, args);
  }
};
class Logger {
  constructor(concreteLogger, options = {}) {
    this.init(concreteLogger, options);
  }
  init(concreteLogger, options = {}) {
    this.prefix = options.prefix || "i18next:";
    this.logger = concreteLogger || consoleLogger;
    this.options = options;
    this.debug = options.debug;
  }
  log(...args) {
    return this.forward(args, "log", "", true);
  }
  warn(...args) {
    return this.forward(args, "warn", "", true);
  }
  error(...args) {
    return this.forward(args, "error", "");
  }
  deprecate(...args) {
    return this.forward(args, "warn", "WARNING DEPRECATED: ", true);
  }
  forward(args, lvl, prefix, debugOnly) {
    if (debugOnly && !this.debug) return null;
    if (isString$1(args[0])) args[0] = `${prefix}${this.prefix} ${args[0]}`;
    return this.logger[lvl](args);
  }
  create(moduleName) {
    return new Logger(this.logger, {
      ...{
        prefix: `${this.prefix}:${moduleName}:`
      },
      ...this.options
    });
  }
  clone(options) {
    options = options || this.options;
    options.prefix = options.prefix || this.prefix;
    return new Logger(this.logger, options);
  }
}
var baseLogger = new Logger();
class EventEmitter {
  constructor() {
    this.observers = {};
  }
  on(events, listener) {
    events.split(" ").forEach((event) => {
      if (!this.observers[event]) this.observers[event] = /* @__PURE__ */ new Map();
      const numListeners = this.observers[event].get(listener) || 0;
      this.observers[event].set(listener, numListeners + 1);
    });
    return this;
  }
  off(event, listener) {
    if (!this.observers[event]) return;
    if (!listener) {
      delete this.observers[event];
      return;
    }
    this.observers[event].delete(listener);
  }
  emit(event, ...args) {
    if (this.observers[event]) {
      const cloned = Array.from(this.observers[event].entries());
      cloned.forEach(([observer, numTimesAdded]) => {
        for (let i = 0; i < numTimesAdded; i++) {
          observer(...args);
        }
      });
    }
    if (this.observers["*"]) {
      const cloned = Array.from(this.observers["*"].entries());
      cloned.forEach(([observer, numTimesAdded]) => {
        for (let i = 0; i < numTimesAdded; i++) {
          observer.apply(observer, [event, ...args]);
        }
      });
    }
  }
}
class ResourceStore extends EventEmitter {
  constructor(data, options = {
    ns: ["translation"],
    defaultNS: "translation"
  }) {
    super();
    this.data = data || {};
    this.options = options;
    if (this.options.keySeparator === void 0) {
      this.options.keySeparator = ".";
    }
    if (this.options.ignoreJSONStructure === void 0) {
      this.options.ignoreJSONStructure = true;
    }
  }
  addNamespaces(ns) {
    if (this.options.ns.indexOf(ns) < 0) {
      this.options.ns.push(ns);
    }
  }
  removeNamespaces(ns) {
    const index = this.options.ns.indexOf(ns);
    if (index > -1) {
      this.options.ns.splice(index, 1);
    }
  }
  getResource(lng, ns, key, options = {}) {
    const keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
    const ignoreJSONStructure = options.ignoreJSONStructure !== void 0 ? options.ignoreJSONStructure : this.options.ignoreJSONStructure;
    let path2;
    if (lng.indexOf(".") > -1) {
      path2 = lng.split(".");
    } else {
      path2 = [lng, ns];
      if (key) {
        if (Array.isArray(key)) {
          path2.push(...key);
        } else if (isString$1(key) && keySeparator) {
          path2.push(...key.split(keySeparator));
        } else {
          path2.push(key);
        }
      }
    }
    const result = getPath(this.data, path2);
    if (!result && !ns && !key && lng.indexOf(".") > -1) {
      lng = path2[0];
      ns = path2[1];
      key = path2.slice(2).join(".");
    }
    if (result || !ignoreJSONStructure || !isString$1(key)) return result;
    return deepFind(this.data?.[lng]?.[ns], key, keySeparator);
  }
  addResource(lng, ns, key, value, options = {
    silent: false
  }) {
    const keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
    let path2 = [lng, ns];
    if (key) path2 = path2.concat(keySeparator ? key.split(keySeparator) : key);
    if (lng.indexOf(".") > -1) {
      path2 = lng.split(".");
      value = ns;
      ns = path2[1];
    }
    this.addNamespaces(ns);
    setPath(this.data, path2, value);
    if (!options.silent) this.emit("added", lng, ns, key, value);
  }
  addResources(lng, ns, resources2, options = {
    silent: false
  }) {
    for (const m2 in resources2) {
      if (isString$1(resources2[m2]) || Array.isArray(resources2[m2])) this.addResource(lng, ns, m2, resources2[m2], {
        silent: true
      });
    }
    if (!options.silent) this.emit("added", lng, ns, resources2);
  }
  addResourceBundle(lng, ns, resources2, deep, overwrite, options = {
    silent: false,
    skipCopy: false
  }) {
    let path2 = [lng, ns];
    if (lng.indexOf(".") > -1) {
      path2 = lng.split(".");
      deep = resources2;
      resources2 = ns;
      ns = path2[1];
    }
    this.addNamespaces(ns);
    let pack = getPath(this.data, path2) || {};
    if (!options.skipCopy) resources2 = JSON.parse(JSON.stringify(resources2));
    if (deep) {
      deepExtend(pack, resources2, overwrite);
    } else {
      pack = {
        ...pack,
        ...resources2
      };
    }
    setPath(this.data, path2, pack);
    if (!options.silent) this.emit("added", lng, ns, resources2);
  }
  removeResourceBundle(lng, ns) {
    if (this.hasResourceBundle(lng, ns)) {
      delete this.data[lng][ns];
    }
    this.removeNamespaces(ns);
    this.emit("removed", lng, ns);
  }
  hasResourceBundle(lng, ns) {
    return this.getResource(lng, ns) !== void 0;
  }
  getResourceBundle(lng, ns) {
    if (!ns) ns = this.options.defaultNS;
    return this.getResource(lng, ns);
  }
  getDataByLanguage(lng) {
    return this.data[lng];
  }
  hasLanguageSomeTranslations(lng) {
    const data = this.getDataByLanguage(lng);
    const n2 = data && Object.keys(data) || [];
    return !!n2.find((v2) => data[v2] && Object.keys(data[v2]).length > 0);
  }
  toJSON() {
    return this.data;
  }
}
var postProcessor = {
  processors: {},
  addPostProcessor(module) {
    this.processors[module.name] = module;
  },
  handle(processors, value, key, options, translator) {
    processors.forEach((processor) => {
      value = this.processors[processor]?.process(value, key, options, translator) ?? value;
    });
    return value;
  }
};
const PATH_KEY = Symbol("i18next/PATH_KEY");
function createProxy() {
  const state = [];
  const handler = /* @__PURE__ */ Object.create(null);
  let proxy2;
  handler.get = (target, key) => {
    proxy2?.revoke?.();
    if (key === PATH_KEY) return state;
    state.push(key);
    proxy2 = Proxy.revocable(target, handler);
    return proxy2.proxy;
  };
  return Proxy.revocable(/* @__PURE__ */ Object.create(null), handler).proxy;
}
function keysFromSelector(selector, opts) {
  const {
    [PATH_KEY]: path2
  } = selector(createProxy());
  return path2.join(opts?.keySeparator ?? ".");
}
const checkedLoadedFor = {};
const shouldHandleAsObject = (res) => !isString$1(res) && typeof res !== "boolean" && typeof res !== "number";
class Translator extends EventEmitter {
  constructor(services, options = {}) {
    super();
    copy(["resourceStore", "languageUtils", "pluralResolver", "interpolator", "backendConnector", "i18nFormat", "utils"], services, this);
    this.options = options;
    if (this.options.keySeparator === void 0) {
      this.options.keySeparator = ".";
    }
    this.logger = baseLogger.create("translator");
  }
  changeLanguage(lng) {
    if (lng) this.language = lng;
  }
  exists(key, o = {
    interpolation: {}
  }) {
    const opt = {
      ...o
    };
    if (key == null) return false;
    const resolved = this.resolve(key, opt);
    if (resolved?.res === void 0) return false;
    const isObject2 = shouldHandleAsObject(resolved.res);
    if (opt.returnObjects === false && isObject2) {
      return false;
    }
    return true;
  }
  extractFromKey(key, opt) {
    let nsSeparator = opt.nsSeparator !== void 0 ? opt.nsSeparator : this.options.nsSeparator;
    if (nsSeparator === void 0) nsSeparator = ":";
    const keySeparator = opt.keySeparator !== void 0 ? opt.keySeparator : this.options.keySeparator;
    let namespaces = opt.ns || this.options.defaultNS || [];
    const wouldCheckForNsInKey = nsSeparator && key.indexOf(nsSeparator) > -1;
    const seemsNaturalLanguage = !this.options.userDefinedKeySeparator && !opt.keySeparator && !this.options.userDefinedNsSeparator && !opt.nsSeparator && !looksLikeObjectPath(key, nsSeparator, keySeparator);
    if (wouldCheckForNsInKey && !seemsNaturalLanguage) {
      const m2 = key.match(this.interpolator.nestingRegexp);
      if (m2 && m2.length > 0) {
        return {
          key,
          namespaces: isString$1(namespaces) ? [namespaces] : namespaces
        };
      }
      const parts = key.split(nsSeparator);
      if (nsSeparator !== keySeparator || nsSeparator === keySeparator && this.options.ns.indexOf(parts[0]) > -1) namespaces = parts.shift();
      key = parts.join(keySeparator);
    }
    return {
      key,
      namespaces: isString$1(namespaces) ? [namespaces] : namespaces
    };
  }
  translate(keys, o, lastKey) {
    let opt = typeof o === "object" ? {
      ...o
    } : o;
    if (typeof opt !== "object" && this.options.overloadTranslationOptionHandler) {
      opt = this.options.overloadTranslationOptionHandler(arguments);
    }
    if (typeof opt === "object") opt = {
      ...opt
    };
    if (!opt) opt = {};
    if (keys == null) return "";
    if (typeof keys === "function") keys = keysFromSelector(keys, {
      ...this.options,
      ...opt
    });
    if (!Array.isArray(keys)) keys = [String(keys)];
    const returnDetails = opt.returnDetails !== void 0 ? opt.returnDetails : this.options.returnDetails;
    const keySeparator = opt.keySeparator !== void 0 ? opt.keySeparator : this.options.keySeparator;
    const {
      key,
      namespaces
    } = this.extractFromKey(keys[keys.length - 1], opt);
    const namespace = namespaces[namespaces.length - 1];
    let nsSeparator = opt.nsSeparator !== void 0 ? opt.nsSeparator : this.options.nsSeparator;
    if (nsSeparator === void 0) nsSeparator = ":";
    const lng = opt.lng || this.language;
    const appendNamespaceToCIMode = opt.appendNamespaceToCIMode || this.options.appendNamespaceToCIMode;
    if (lng?.toLowerCase() === "cimode") {
      if (appendNamespaceToCIMode) {
        if (returnDetails) {
          return {
            res: `${namespace}${nsSeparator}${key}`,
            usedKey: key,
            exactUsedKey: key,
            usedLng: lng,
            usedNS: namespace,
            usedParams: this.getUsedParamsDetails(opt)
          };
        }
        return `${namespace}${nsSeparator}${key}`;
      }
      if (returnDetails) {
        return {
          res: key,
          usedKey: key,
          exactUsedKey: key,
          usedLng: lng,
          usedNS: namespace,
          usedParams: this.getUsedParamsDetails(opt)
        };
      }
      return key;
    }
    const resolved = this.resolve(keys, opt);
    let res = resolved?.res;
    const resUsedKey = resolved?.usedKey || key;
    const resExactUsedKey = resolved?.exactUsedKey || key;
    const noObject = ["[object Number]", "[object Function]", "[object RegExp]"];
    const joinArrays = opt.joinArrays !== void 0 ? opt.joinArrays : this.options.joinArrays;
    const handleAsObjectInI18nFormat = !this.i18nFormat || this.i18nFormat.handleAsObject;
    const needsPluralHandling = opt.count !== void 0 && !isString$1(opt.count);
    const hasDefaultValue = Translator.hasDefaultValue(opt);
    const defaultValueSuffix = needsPluralHandling ? this.pluralResolver.getSuffix(lng, opt.count, opt) : "";
    const defaultValueSuffixOrdinalFallback = opt.ordinal && needsPluralHandling ? this.pluralResolver.getSuffix(lng, opt.count, {
      ordinal: false
    }) : "";
    const needsZeroSuffixLookup = needsPluralHandling && !opt.ordinal && opt.count === 0;
    const defaultValue = needsZeroSuffixLookup && opt[`defaultValue${this.options.pluralSeparator}zero`] || opt[`defaultValue${defaultValueSuffix}`] || opt[`defaultValue${defaultValueSuffixOrdinalFallback}`] || opt.defaultValue;
    let resForObjHndl = res;
    if (handleAsObjectInI18nFormat && !res && hasDefaultValue) {
      resForObjHndl = defaultValue;
    }
    const handleAsObject = shouldHandleAsObject(resForObjHndl);
    const resType = Object.prototype.toString.apply(resForObjHndl);
    if (handleAsObjectInI18nFormat && resForObjHndl && handleAsObject && noObject.indexOf(resType) < 0 && !(isString$1(joinArrays) && Array.isArray(resForObjHndl))) {
      if (!opt.returnObjects && !this.options.returnObjects) {
        if (!this.options.returnedObjectHandler) {
          this.logger.warn("accessing an object - but returnObjects options is not enabled!");
        }
        const r2 = this.options.returnedObjectHandler ? this.options.returnedObjectHandler(resUsedKey, resForObjHndl, {
          ...opt,
          ns: namespaces
        }) : `key '${key} (${this.language})' returned an object instead of string.`;
        if (returnDetails) {
          resolved.res = r2;
          resolved.usedParams = this.getUsedParamsDetails(opt);
          return resolved;
        }
        return r2;
      }
      if (keySeparator) {
        const resTypeIsArray = Array.isArray(resForObjHndl);
        const copy2 = resTypeIsArray ? [] : {};
        const newKeyToUse = resTypeIsArray ? resExactUsedKey : resUsedKey;
        for (const m2 in resForObjHndl) {
          if (Object.prototype.hasOwnProperty.call(resForObjHndl, m2)) {
            const deepKey = `${newKeyToUse}${keySeparator}${m2}`;
            if (hasDefaultValue && !res) {
              copy2[m2] = this.translate(deepKey, {
                ...opt,
                defaultValue: shouldHandleAsObject(defaultValue) ? defaultValue[m2] : void 0,
                ...{
                  joinArrays: false,
                  ns: namespaces
                }
              });
            } else {
              copy2[m2] = this.translate(deepKey, {
                ...opt,
                ...{
                  joinArrays: false,
                  ns: namespaces
                }
              });
            }
            if (copy2[m2] === deepKey) copy2[m2] = resForObjHndl[m2];
          }
        }
        res = copy2;
      }
    } else if (handleAsObjectInI18nFormat && isString$1(joinArrays) && Array.isArray(res)) {
      res = res.join(joinArrays);
      if (res) res = this.extendTranslation(res, keys, opt, lastKey);
    } else {
      let usedDefault = false;
      let usedKey = false;
      if (!this.isValidLookup(res) && hasDefaultValue) {
        usedDefault = true;
        res = defaultValue;
      }
      if (!this.isValidLookup(res)) {
        usedKey = true;
        res = key;
      }
      const missingKeyNoValueFallbackToKey = opt.missingKeyNoValueFallbackToKey || this.options.missingKeyNoValueFallbackToKey;
      const resForMissing = missingKeyNoValueFallbackToKey && usedKey ? void 0 : res;
      const updateMissing = hasDefaultValue && defaultValue !== res && this.options.updateMissing;
      if (usedKey || usedDefault || updateMissing) {
        this.logger.log(updateMissing ? "updateKey" : "missingKey", lng, namespace, key, updateMissing ? defaultValue : res);
        if (keySeparator) {
          const fk2 = this.resolve(key, {
            ...opt,
            keySeparator: false
          });
          if (fk2 && fk2.res) this.logger.warn("Seems the loaded translations were in flat JSON format instead of nested. Either set keySeparator: false on init or make sure your translations are published in nested format.");
        }
        let lngs = [];
        const fallbackLngs = this.languageUtils.getFallbackCodes(this.options.fallbackLng, opt.lng || this.language);
        if (this.options.saveMissingTo === "fallback" && fallbackLngs && fallbackLngs[0]) {
          for (let i = 0; i < fallbackLngs.length; i++) {
            lngs.push(fallbackLngs[i]);
          }
        } else if (this.options.saveMissingTo === "all") {
          lngs = this.languageUtils.toResolveHierarchy(opt.lng || this.language);
        } else {
          lngs.push(opt.lng || this.language);
        }
        const send = (l2, k2, specificDefaultValue) => {
          const defaultForMissing = hasDefaultValue && specificDefaultValue !== res ? specificDefaultValue : resForMissing;
          if (this.options.missingKeyHandler) {
            this.options.missingKeyHandler(l2, namespace, k2, defaultForMissing, updateMissing, opt);
          } else if (this.backendConnector?.saveMissing) {
            this.backendConnector.saveMissing(l2, namespace, k2, defaultForMissing, updateMissing, opt);
          }
          this.emit("missingKey", l2, namespace, k2, res);
        };
        if (this.options.saveMissing) {
          if (this.options.saveMissingPlurals && needsPluralHandling) {
            lngs.forEach((language) => {
              const suffixes = this.pluralResolver.getSuffixes(language, opt);
              if (needsZeroSuffixLookup && opt[`defaultValue${this.options.pluralSeparator}zero`] && suffixes.indexOf(`${this.options.pluralSeparator}zero`) < 0) {
                suffixes.push(`${this.options.pluralSeparator}zero`);
              }
              suffixes.forEach((suffix) => {
                send([language], key + suffix, opt[`defaultValue${suffix}`] || defaultValue);
              });
            });
          } else {
            send(lngs, key, defaultValue);
          }
        }
      }
      res = this.extendTranslation(res, keys, opt, resolved, lastKey);
      if (usedKey && res === key && this.options.appendNamespaceToMissingKey) {
        res = `${namespace}${nsSeparator}${key}`;
      }
      if ((usedKey || usedDefault) && this.options.parseMissingKeyHandler) {
        res = this.options.parseMissingKeyHandler(this.options.appendNamespaceToMissingKey ? `${namespace}${nsSeparator}${key}` : key, usedDefault ? res : void 0, opt);
      }
    }
    if (returnDetails) {
      resolved.res = res;
      resolved.usedParams = this.getUsedParamsDetails(opt);
      return resolved;
    }
    return res;
  }
  extendTranslation(res, key, opt, resolved, lastKey) {
    if (this.i18nFormat?.parse) {
      res = this.i18nFormat.parse(res, {
        ...this.options.interpolation.defaultVariables,
        ...opt
      }, opt.lng || this.language || resolved.usedLng, resolved.usedNS, resolved.usedKey, {
        resolved
      });
    } else if (!opt.skipInterpolation) {
      if (opt.interpolation) this.interpolator.init({
        ...opt,
        ...{
          interpolation: {
            ...this.options.interpolation,
            ...opt.interpolation
          }
        }
      });
      const skipOnVariables = isString$1(res) && (opt?.interpolation?.skipOnVariables !== void 0 ? opt.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables);
      let nestBef;
      if (skipOnVariables) {
        const nb2 = res.match(this.interpolator.nestingRegexp);
        nestBef = nb2 && nb2.length;
      }
      let data = opt.replace && !isString$1(opt.replace) ? opt.replace : opt;
      if (this.options.interpolation.defaultVariables) data = {
        ...this.options.interpolation.defaultVariables,
        ...data
      };
      res = this.interpolator.interpolate(res, data, opt.lng || this.language || resolved.usedLng, opt);
      if (skipOnVariables) {
        const na = res.match(this.interpolator.nestingRegexp);
        const nestAft = na && na.length;
        if (nestBef < nestAft) opt.nest = false;
      }
      if (!opt.lng && resolved && resolved.res) opt.lng = this.language || resolved.usedLng;
      if (opt.nest !== false) res = this.interpolator.nest(res, (...args) => {
        if (lastKey?.[0] === args[0] && !opt.context) {
          this.logger.warn(`It seems you are nesting recursively key: ${args[0]} in key: ${key[0]}`);
          return null;
        }
        return this.translate(...args, key);
      }, opt);
      if (opt.interpolation) this.interpolator.reset();
    }
    const postProcess = opt.postProcess || this.options.postProcess;
    const postProcessorNames = isString$1(postProcess) ? [postProcess] : postProcess;
    if (res != null && postProcessorNames?.length && opt.applyPostProcessor !== false) {
      res = postProcessor.handle(postProcessorNames, res, key, this.options && this.options.postProcessPassResolved ? {
        i18nResolved: {
          ...resolved,
          usedParams: this.getUsedParamsDetails(opt)
        },
        ...opt
      } : opt, this);
    }
    return res;
  }
  resolve(keys, opt = {}) {
    let found;
    let usedKey;
    let exactUsedKey;
    let usedLng;
    let usedNS;
    if (isString$1(keys)) keys = [keys];
    keys.forEach((k2) => {
      if (this.isValidLookup(found)) return;
      const extracted = this.extractFromKey(k2, opt);
      const key = extracted.key;
      usedKey = key;
      let namespaces = extracted.namespaces;
      if (this.options.fallbackNS) namespaces = namespaces.concat(this.options.fallbackNS);
      const needsPluralHandling = opt.count !== void 0 && !isString$1(opt.count);
      const needsZeroSuffixLookup = needsPluralHandling && !opt.ordinal && opt.count === 0;
      const needsContextHandling = opt.context !== void 0 && (isString$1(opt.context) || typeof opt.context === "number") && opt.context !== "";
      const codes = opt.lngs ? opt.lngs : this.languageUtils.toResolveHierarchy(opt.lng || this.language, opt.fallbackLng);
      namespaces.forEach((ns) => {
        if (this.isValidLookup(found)) return;
        usedNS = ns;
        if (!checkedLoadedFor[`${codes[0]}-${ns}`] && this.utils?.hasLoadedNamespace && !this.utils?.hasLoadedNamespace(usedNS)) {
          checkedLoadedFor[`${codes[0]}-${ns}`] = true;
          this.logger.warn(`key "${usedKey}" for languages "${codes.join(", ")}" won't get resolved as namespace "${usedNS}" was not yet loaded`, "This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!");
        }
        codes.forEach((code) => {
          if (this.isValidLookup(found)) return;
          usedLng = code;
          const finalKeys = [key];
          if (this.i18nFormat?.addLookupKeys) {
            this.i18nFormat.addLookupKeys(finalKeys, key, code, ns, opt);
          } else {
            let pluralSuffix;
            if (needsPluralHandling) pluralSuffix = this.pluralResolver.getSuffix(code, opt.count, opt);
            const zeroSuffix = `${this.options.pluralSeparator}zero`;
            const ordinalPrefix = `${this.options.pluralSeparator}ordinal${this.options.pluralSeparator}`;
            if (needsPluralHandling) {
              if (opt.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                finalKeys.push(key + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
              }
              finalKeys.push(key + pluralSuffix);
              if (needsZeroSuffixLookup) {
                finalKeys.push(key + zeroSuffix);
              }
            }
            if (needsContextHandling) {
              const contextKey = `${key}${this.options.contextSeparator || "_"}${opt.context}`;
              finalKeys.push(contextKey);
              if (needsPluralHandling) {
                if (opt.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                  finalKeys.push(contextKey + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
                }
                finalKeys.push(contextKey + pluralSuffix);
                if (needsZeroSuffixLookup) {
                  finalKeys.push(contextKey + zeroSuffix);
                }
              }
            }
          }
          let possibleKey;
          while (possibleKey = finalKeys.pop()) {
            if (!this.isValidLookup(found)) {
              exactUsedKey = possibleKey;
              found = this.getResource(code, ns, possibleKey, opt);
            }
          }
        });
      });
    });
    return {
      res: found,
      usedKey,
      exactUsedKey,
      usedLng,
      usedNS
    };
  }
  isValidLookup(res) {
    return res !== void 0 && !(!this.options.returnNull && res === null) && !(!this.options.returnEmptyString && res === "");
  }
  getResource(code, ns, key, options = {}) {
    if (this.i18nFormat?.getResource) return this.i18nFormat.getResource(code, ns, key, options);
    return this.resourceStore.getResource(code, ns, key, options);
  }
  getUsedParamsDetails(options = {}) {
    const optionsKeys = ["defaultValue", "ordinal", "context", "replace", "lng", "lngs", "fallbackLng", "ns", "keySeparator", "nsSeparator", "returnObjects", "returnDetails", "joinArrays", "postProcess", "interpolation"];
    const useOptionsReplaceForData = options.replace && !isString$1(options.replace);
    let data = useOptionsReplaceForData ? options.replace : options;
    if (useOptionsReplaceForData && typeof options.count !== "undefined") {
      data.count = options.count;
    }
    if (this.options.interpolation.defaultVariables) {
      data = {
        ...this.options.interpolation.defaultVariables,
        ...data
      };
    }
    if (!useOptionsReplaceForData) {
      data = {
        ...data
      };
      for (const key of optionsKeys) {
        delete data[key];
      }
    }
    return data;
  }
  static hasDefaultValue(options) {
    const prefix = "defaultValue";
    for (const option in options) {
      if (Object.prototype.hasOwnProperty.call(options, option) && prefix === option.substring(0, prefix.length) && void 0 !== options[option]) {
        return true;
      }
    }
    return false;
  }
}
class LanguageUtil {
  constructor(options) {
    this.options = options;
    this.supportedLngs = this.options.supportedLngs || false;
    this.logger = baseLogger.create("languageUtils");
  }
  getScriptPartFromCode(code) {
    code = getCleanedCode(code);
    if (!code || code.indexOf("-") < 0) return null;
    const p2 = code.split("-");
    if (p2.length === 2) return null;
    p2.pop();
    if (p2[p2.length - 1].toLowerCase() === "x") return null;
    return this.formatLanguageCode(p2.join("-"));
  }
  getLanguagePartFromCode(code) {
    code = getCleanedCode(code);
    if (!code || code.indexOf("-") < 0) return code;
    const p2 = code.split("-");
    return this.formatLanguageCode(p2[0]);
  }
  formatLanguageCode(code) {
    if (isString$1(code) && code.indexOf("-") > -1) {
      let formattedCode;
      try {
        formattedCode = Intl.getCanonicalLocales(code)[0];
      } catch (e) {
      }
      if (formattedCode && this.options.lowerCaseLng) {
        formattedCode = formattedCode.toLowerCase();
      }
      if (formattedCode) return formattedCode;
      if (this.options.lowerCaseLng) {
        return code.toLowerCase();
      }
      return code;
    }
    return this.options.cleanCode || this.options.lowerCaseLng ? code.toLowerCase() : code;
  }
  isSupportedCode(code) {
    if (this.options.load === "languageOnly" || this.options.nonExplicitSupportedLngs) {
      code = this.getLanguagePartFromCode(code);
    }
    return !this.supportedLngs || !this.supportedLngs.length || this.supportedLngs.indexOf(code) > -1;
  }
  getBestMatchFromCodes(codes) {
    if (!codes) return null;
    let found;
    codes.forEach((code) => {
      if (found) return;
      const cleanedLng = this.formatLanguageCode(code);
      if (!this.options.supportedLngs || this.isSupportedCode(cleanedLng)) found = cleanedLng;
    });
    if (!found && this.options.supportedLngs) {
      codes.forEach((code) => {
        if (found) return;
        const lngScOnly = this.getScriptPartFromCode(code);
        if (this.isSupportedCode(lngScOnly)) return found = lngScOnly;
        const lngOnly = this.getLanguagePartFromCode(code);
        if (this.isSupportedCode(lngOnly)) return found = lngOnly;
        found = this.options.supportedLngs.find((supportedLng) => {
          if (supportedLng === lngOnly) return supportedLng;
          if (supportedLng.indexOf("-") < 0 && lngOnly.indexOf("-") < 0) return;
          if (supportedLng.indexOf("-") > 0 && lngOnly.indexOf("-") < 0 && supportedLng.substring(0, supportedLng.indexOf("-")) === lngOnly) return supportedLng;
          if (supportedLng.indexOf(lngOnly) === 0 && lngOnly.length > 1) return supportedLng;
        });
      });
    }
    if (!found) found = this.getFallbackCodes(this.options.fallbackLng)[0];
    return found;
  }
  getFallbackCodes(fallbacks, code) {
    if (!fallbacks) return [];
    if (typeof fallbacks === "function") fallbacks = fallbacks(code);
    if (isString$1(fallbacks)) fallbacks = [fallbacks];
    if (Array.isArray(fallbacks)) return fallbacks;
    if (!code) return fallbacks.default || [];
    let found = fallbacks[code];
    if (!found) found = fallbacks[this.getScriptPartFromCode(code)];
    if (!found) found = fallbacks[this.formatLanguageCode(code)];
    if (!found) found = fallbacks[this.getLanguagePartFromCode(code)];
    if (!found) found = fallbacks.default;
    return found || [];
  }
  toResolveHierarchy(code, fallbackCode) {
    const fallbackCodes = this.getFallbackCodes((fallbackCode === false ? [] : fallbackCode) || this.options.fallbackLng || [], code);
    const codes = [];
    const addCode = (c) => {
      if (!c) return;
      if (this.isSupportedCode(c)) {
        codes.push(c);
      } else {
        this.logger.warn(`rejecting language code not found in supportedLngs: ${c}`);
      }
    };
    if (isString$1(code) && (code.indexOf("-") > -1 || code.indexOf("_") > -1)) {
      if (this.options.load !== "languageOnly") addCode(this.formatLanguageCode(code));
      if (this.options.load !== "languageOnly" && this.options.load !== "currentOnly") addCode(this.getScriptPartFromCode(code));
      if (this.options.load !== "currentOnly") addCode(this.getLanguagePartFromCode(code));
    } else if (isString$1(code)) {
      addCode(this.formatLanguageCode(code));
    }
    fallbackCodes.forEach((fc2) => {
      if (codes.indexOf(fc2) < 0) addCode(this.formatLanguageCode(fc2));
    });
    return codes;
  }
}
const suffixesOrder = {
  zero: 0,
  one: 1,
  two: 2,
  few: 3,
  many: 4,
  other: 5
};
const dummyRule = {
  select: (count2) => count2 === 1 ? "one" : "other",
  resolvedOptions: () => ({
    pluralCategories: ["one", "other"]
  })
};
class PluralResolver {
  constructor(languageUtils, options = {}) {
    this.languageUtils = languageUtils;
    this.options = options;
    this.logger = baseLogger.create("pluralResolver");
    this.pluralRulesCache = {};
  }
  clearCache() {
    this.pluralRulesCache = {};
  }
  getRule(code, options = {}) {
    const cleanedCode = getCleanedCode(code === "dev" ? "en" : code);
    const type = options.ordinal ? "ordinal" : "cardinal";
    const cacheKey = JSON.stringify({
      cleanedCode,
      type
    });
    if (cacheKey in this.pluralRulesCache) {
      return this.pluralRulesCache[cacheKey];
    }
    let rule;
    try {
      rule = new Intl.PluralRules(cleanedCode, {
        type
      });
    } catch (err) {
      if (typeof Intl === "undefined") {
        this.logger.error("No Intl support, please use an Intl polyfill!");
        return dummyRule;
      }
      if (!code.match(/-|_/)) return dummyRule;
      const lngPart = this.languageUtils.getLanguagePartFromCode(code);
      rule = this.getRule(lngPart, options);
    }
    this.pluralRulesCache[cacheKey] = rule;
    return rule;
  }
  needsPlural(code, options = {}) {
    let rule = this.getRule(code, options);
    if (!rule) rule = this.getRule("dev", options);
    return rule?.resolvedOptions().pluralCategories.length > 1;
  }
  getPluralFormsOfKey(code, key, options = {}) {
    return this.getSuffixes(code, options).map((suffix) => `${key}${suffix}`);
  }
  getSuffixes(code, options = {}) {
    let rule = this.getRule(code, options);
    if (!rule) rule = this.getRule("dev", options);
    if (!rule) return [];
    return rule.resolvedOptions().pluralCategories.sort((pluralCategory1, pluralCategory2) => suffixesOrder[pluralCategory1] - suffixesOrder[pluralCategory2]).map((pluralCategory) => `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ""}${pluralCategory}`);
  }
  getSuffix(code, count2, options = {}) {
    const rule = this.getRule(code, options);
    if (rule) {
      return `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ""}${rule.select(count2)}`;
    }
    this.logger.warn(`no plural rule found for: ${code}`);
    return this.getSuffix("dev", count2, options);
  }
}
const deepFindWithDefaults = (data, defaultData, key, keySeparator = ".", ignoreJSONStructure = true) => {
  let path2 = getPathWithDefaults(data, defaultData, key);
  if (!path2 && ignoreJSONStructure && isString$1(key)) {
    path2 = deepFind(data, key, keySeparator);
    if (path2 === void 0) path2 = deepFind(defaultData, key, keySeparator);
  }
  return path2;
};
const regexSafe = (val) => val.replace(/\$/g, "$$$$");
class Interpolator {
  constructor(options = {}) {
    this.logger = baseLogger.create("interpolator");
    this.options = options;
    this.format = options?.interpolation?.format || ((value) => value);
    this.init(options);
  }
  init(options = {}) {
    if (!options.interpolation) options.interpolation = {
      escapeValue: true
    };
    const {
      escape: escape$12,
      escapeValue,
      useRawValueToEscape,
      prefix,
      prefixEscaped,
      suffix,
      suffixEscaped,
      formatSeparator,
      unescapeSuffix,
      unescapePrefix,
      nestingPrefix,
      nestingPrefixEscaped,
      nestingSuffix,
      nestingSuffixEscaped,
      nestingOptionsSeparator,
      maxReplaces,
      alwaysFormat
    } = options.interpolation;
    this.escape = escape$12 !== void 0 ? escape$12 : escape;
    this.escapeValue = escapeValue !== void 0 ? escapeValue : true;
    this.useRawValueToEscape = useRawValueToEscape !== void 0 ? useRawValueToEscape : false;
    this.prefix = prefix ? regexEscape(prefix) : prefixEscaped || "{{";
    this.suffix = suffix ? regexEscape(suffix) : suffixEscaped || "}}";
    this.formatSeparator = formatSeparator || ",";
    this.unescapePrefix = unescapeSuffix ? "" : unescapePrefix || "-";
    this.unescapeSuffix = this.unescapePrefix ? "" : unescapeSuffix || "";
    this.nestingPrefix = nestingPrefix ? regexEscape(nestingPrefix) : nestingPrefixEscaped || regexEscape("$t(");
    this.nestingSuffix = nestingSuffix ? regexEscape(nestingSuffix) : nestingSuffixEscaped || regexEscape(")");
    this.nestingOptionsSeparator = nestingOptionsSeparator || ",";
    this.maxReplaces = maxReplaces || 1e3;
    this.alwaysFormat = alwaysFormat !== void 0 ? alwaysFormat : false;
    this.resetRegExp();
  }
  reset() {
    if (this.options) this.init(this.options);
  }
  resetRegExp() {
    const getOrResetRegExp = (existingRegExp, pattern) => {
      if (existingRegExp?.source === pattern) {
        existingRegExp.lastIndex = 0;
        return existingRegExp;
      }
      return new RegExp(pattern, "g");
    };
    this.regexp = getOrResetRegExp(this.regexp, `${this.prefix}(.+?)${this.suffix}`);
    this.regexpUnescape = getOrResetRegExp(this.regexpUnescape, `${this.prefix}${this.unescapePrefix}(.+?)${this.unescapeSuffix}${this.suffix}`);
    this.nestingRegexp = getOrResetRegExp(this.nestingRegexp, `${this.nestingPrefix}((?:[^()"']+|"[^"]*"|'[^']*'|\\((?:[^()]|"[^"]*"|'[^']*')*\\))*?)${this.nestingSuffix}`);
  }
  interpolate(str, data, lng, options) {
    let match;
    let value;
    let replaces;
    const defaultData = this.options && this.options.interpolation && this.options.interpolation.defaultVariables || {};
    const handleFormat = (key) => {
      if (key.indexOf(this.formatSeparator) < 0) {
        const path2 = deepFindWithDefaults(data, defaultData, key, this.options.keySeparator, this.options.ignoreJSONStructure);
        return this.alwaysFormat ? this.format(path2, void 0, lng, {
          ...options,
          ...data,
          interpolationkey: key
        }) : path2;
      }
      const p2 = key.split(this.formatSeparator);
      const k2 = p2.shift().trim();
      const f2 = p2.join(this.formatSeparator).trim();
      return this.format(deepFindWithDefaults(data, defaultData, k2, this.options.keySeparator, this.options.ignoreJSONStructure), f2, lng, {
        ...options,
        ...data,
        interpolationkey: k2
      });
    };
    this.resetRegExp();
    const missingInterpolationHandler = options?.missingInterpolationHandler || this.options.missingInterpolationHandler;
    const skipOnVariables = options?.interpolation?.skipOnVariables !== void 0 ? options.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables;
    const todos = [{
      regex: this.regexpUnescape,
      safeValue: (val) => regexSafe(val)
    }, {
      regex: this.regexp,
      safeValue: (val) => this.escapeValue ? regexSafe(this.escape(val)) : regexSafe(val)
    }];
    todos.forEach((todo) => {
      replaces = 0;
      while (match = todo.regex.exec(str)) {
        const matchedVar = match[1].trim();
        value = handleFormat(matchedVar);
        if (value === void 0) {
          if (typeof missingInterpolationHandler === "function") {
            const temp = missingInterpolationHandler(str, match, options);
            value = isString$1(temp) ? temp : "";
          } else if (options && Object.prototype.hasOwnProperty.call(options, matchedVar)) {
            value = "";
          } else if (skipOnVariables) {
            value = match[0];
            continue;
          } else {
            this.logger.warn(`missed to pass in variable ${matchedVar} for interpolating ${str}`);
            value = "";
          }
        } else if (!isString$1(value) && !this.useRawValueToEscape) {
          value = makeString(value);
        }
        const safeValue = todo.safeValue(value);
        str = str.replace(match[0], safeValue);
        if (skipOnVariables) {
          todo.regex.lastIndex += value.length;
          todo.regex.lastIndex -= match[0].length;
        } else {
          todo.regex.lastIndex = 0;
        }
        replaces++;
        if (replaces >= this.maxReplaces) {
          break;
        }
      }
    });
    return str;
  }
  nest(str, fc2, options = {}) {
    let match;
    let value;
    let clonedOptions;
    const handleHasOptions = (key, inheritedOptions) => {
      const sep = this.nestingOptionsSeparator;
      if (key.indexOf(sep) < 0) return key;
      const c = key.split(new RegExp(`${regexEscape(sep)}[ ]*{`));
      let optionsString = `{${c[1]}`;
      key = c[0];
      optionsString = this.interpolate(optionsString, clonedOptions);
      const matchedSingleQuotes = optionsString.match(/'/g);
      const matchedDoubleQuotes = optionsString.match(/"/g);
      if ((matchedSingleQuotes?.length ?? 0) % 2 === 0 && !matchedDoubleQuotes || (matchedDoubleQuotes?.length ?? 0) % 2 !== 0) {
        optionsString = optionsString.replace(/'/g, '"');
      }
      try {
        clonedOptions = JSON.parse(optionsString);
        if (inheritedOptions) clonedOptions = {
          ...inheritedOptions,
          ...clonedOptions
        };
      } catch (e) {
        this.logger.warn(`failed parsing options string in nesting for key ${key}`, e);
        return `${key}${sep}${optionsString}`;
      }
      if (clonedOptions.defaultValue && clonedOptions.defaultValue.indexOf(this.prefix) > -1) delete clonedOptions.defaultValue;
      return key;
    };
    while (match = this.nestingRegexp.exec(str)) {
      let formatters = [];
      clonedOptions = {
        ...options
      };
      clonedOptions = clonedOptions.replace && !isString$1(clonedOptions.replace) ? clonedOptions.replace : clonedOptions;
      clonedOptions.applyPostProcessor = false;
      delete clonedOptions.defaultValue;
      const keyEndIndex = /{.*}/.test(match[1]) ? match[1].lastIndexOf("}") + 1 : match[1].indexOf(this.formatSeparator);
      if (keyEndIndex !== -1) {
        formatters = match[1].slice(keyEndIndex).split(this.formatSeparator).map((elem) => elem.trim()).filter(Boolean);
        match[1] = match[1].slice(0, keyEndIndex);
      }
      value = fc2(handleHasOptions.call(this, match[1].trim(), clonedOptions), clonedOptions);
      if (value && match[0] === str && !isString$1(value)) return value;
      if (!isString$1(value)) value = makeString(value);
      if (!value) {
        this.logger.warn(`missed to resolve ${match[1]} for nesting ${str}`);
        value = "";
      }
      if (formatters.length) {
        value = formatters.reduce((v2, f2) => this.format(v2, f2, options.lng, {
          ...options,
          interpolationkey: match[1].trim()
        }), value.trim());
      }
      str = str.replace(match[0], value);
      this.regexp.lastIndex = 0;
    }
    return str;
  }
}
const parseFormatStr = (formatStr) => {
  let formatName = formatStr.toLowerCase().trim();
  const formatOptions = {};
  if (formatStr.indexOf("(") > -1) {
    const p2 = formatStr.split("(");
    formatName = p2[0].toLowerCase().trim();
    const optStr = p2[1].substring(0, p2[1].length - 1);
    if (formatName === "currency" && optStr.indexOf(":") < 0) {
      if (!formatOptions.currency) formatOptions.currency = optStr.trim();
    } else if (formatName === "relativetime" && optStr.indexOf(":") < 0) {
      if (!formatOptions.range) formatOptions.range = optStr.trim();
    } else {
      const opts = optStr.split(";");
      opts.forEach((opt) => {
        if (opt) {
          const [key, ...rest] = opt.split(":");
          const val = rest.join(":").trim().replace(/^'+|'+$/g, "");
          const trimmedKey = key.trim();
          if (!formatOptions[trimmedKey]) formatOptions[trimmedKey] = val;
          if (val === "false") formatOptions[trimmedKey] = false;
          if (val === "true") formatOptions[trimmedKey] = true;
          if (!isNaN(val)) formatOptions[trimmedKey] = parseInt(val, 10);
        }
      });
    }
  }
  return {
    formatName,
    formatOptions
  };
};
const createCachedFormatter = (fn) => {
  const cache = {};
  return (v2, l2, o) => {
    let optForCache = o;
    if (o && o.interpolationkey && o.formatParams && o.formatParams[o.interpolationkey] && o[o.interpolationkey]) {
      optForCache = {
        ...optForCache,
        [o.interpolationkey]: void 0
      };
    }
    const key = l2 + JSON.stringify(optForCache);
    let frm = cache[key];
    if (!frm) {
      frm = fn(getCleanedCode(l2), o);
      cache[key] = frm;
    }
    return frm(v2);
  };
};
const createNonCachedFormatter = (fn) => (v2, l2, o) => fn(getCleanedCode(l2), o)(v2);
class Formatter {
  constructor(options = {}) {
    this.logger = baseLogger.create("formatter");
    this.options = options;
    this.init(options);
  }
  init(services, options = {
    interpolation: {}
  }) {
    this.formatSeparator = options.interpolation.formatSeparator || ",";
    const cf2 = options.cacheInBuiltFormats ? createCachedFormatter : createNonCachedFormatter;
    this.formats = {
      number: cf2((lng, opt) => {
        const formatter = new Intl.NumberFormat(lng, {
          ...opt
        });
        return (val) => formatter.format(val);
      }),
      currency: cf2((lng, opt) => {
        const formatter = new Intl.NumberFormat(lng, {
          ...opt,
          style: "currency"
        });
        return (val) => formatter.format(val);
      }),
      datetime: cf2((lng, opt) => {
        const formatter = new Intl.DateTimeFormat(lng, {
          ...opt
        });
        return (val) => formatter.format(val);
      }),
      relativetime: cf2((lng, opt) => {
        const formatter = new Intl.RelativeTimeFormat(lng, {
          ...opt
        });
        return (val) => formatter.format(val, opt.range || "day");
      }),
      list: cf2((lng, opt) => {
        const formatter = new Intl.ListFormat(lng, {
          ...opt
        });
        return (val) => formatter.format(val);
      })
    };
  }
  add(name, fc2) {
    this.formats[name.toLowerCase().trim()] = fc2;
  }
  addCached(name, fc2) {
    this.formats[name.toLowerCase().trim()] = createCachedFormatter(fc2);
  }
  format(value, format, lng, options = {}) {
    const formats = format.split(this.formatSeparator);
    if (formats.length > 1 && formats[0].indexOf("(") > 1 && formats[0].indexOf(")") < 0 && formats.find((f2) => f2.indexOf(")") > -1)) {
      const lastIndex = formats.findIndex((f2) => f2.indexOf(")") > -1);
      formats[0] = [formats[0], ...formats.splice(1, lastIndex)].join(this.formatSeparator);
    }
    const result = formats.reduce((mem, f2) => {
      const {
        formatName,
        formatOptions
      } = parseFormatStr(f2);
      if (this.formats[formatName]) {
        let formatted = mem;
        try {
          const valOptions = options?.formatParams?.[options.interpolationkey] || {};
          const l2 = valOptions.locale || valOptions.lng || options.locale || options.lng || lng;
          formatted = this.formats[formatName](mem, l2, {
            ...formatOptions,
            ...options,
            ...valOptions
          });
        } catch (error) {
          this.logger.warn(error);
        }
        return formatted;
      } else {
        this.logger.warn(`there was no format function for ${formatName}`);
      }
      return mem;
    }, value);
    return result;
  }
}
const removePending = (q2, name) => {
  if (q2.pending[name] !== void 0) {
    delete q2.pending[name];
    q2.pendingCount--;
  }
};
class Connector extends EventEmitter {
  constructor(backend, store, services, options = {}) {
    super();
    this.backend = backend;
    this.store = store;
    this.services = services;
    this.languageUtils = services.languageUtils;
    this.options = options;
    this.logger = baseLogger.create("backendConnector");
    this.waitingReads = [];
    this.maxParallelReads = options.maxParallelReads || 10;
    this.readingCalls = 0;
    this.maxRetries = options.maxRetries >= 0 ? options.maxRetries : 5;
    this.retryTimeout = options.retryTimeout >= 1 ? options.retryTimeout : 350;
    this.state = {};
    this.queue = [];
    this.backend?.init?.(services, options.backend, options);
  }
  queueLoad(languages, namespaces, options, callback) {
    const toLoad = {};
    const pending = {};
    const toLoadLanguages = {};
    const toLoadNamespaces = {};
    languages.forEach((lng) => {
      let hasAllNamespaces = true;
      namespaces.forEach((ns) => {
        const name = `${lng}|${ns}`;
        if (!options.reload && this.store.hasResourceBundle(lng, ns)) {
          this.state[name] = 2;
        } else if (this.state[name] < 0) ;
        else if (this.state[name] === 1) {
          if (pending[name] === void 0) pending[name] = true;
        } else {
          this.state[name] = 1;
          hasAllNamespaces = false;
          if (pending[name] === void 0) pending[name] = true;
          if (toLoad[name] === void 0) toLoad[name] = true;
          if (toLoadNamespaces[ns] === void 0) toLoadNamespaces[ns] = true;
        }
      });
      if (!hasAllNamespaces) toLoadLanguages[lng] = true;
    });
    if (Object.keys(toLoad).length || Object.keys(pending).length) {
      this.queue.push({
        pending,
        pendingCount: Object.keys(pending).length,
        loaded: {},
        errors: [],
        callback
      });
    }
    return {
      toLoad: Object.keys(toLoad),
      pending: Object.keys(pending),
      toLoadLanguages: Object.keys(toLoadLanguages),
      toLoadNamespaces: Object.keys(toLoadNamespaces)
    };
  }
  loaded(name, err, data) {
    const s = name.split("|");
    const lng = s[0];
    const ns = s[1];
    if (err) this.emit("failedLoading", lng, ns, err);
    if (!err && data) {
      this.store.addResourceBundle(lng, ns, data, void 0, void 0, {
        skipCopy: true
      });
    }
    this.state[name] = err ? -1 : 2;
    if (err && data) this.state[name] = 0;
    const loaded = {};
    this.queue.forEach((q2) => {
      pushPath(q2.loaded, [lng], ns);
      removePending(q2, name);
      if (err) q2.errors.push(err);
      if (q2.pendingCount === 0 && !q2.done) {
        Object.keys(q2.loaded).forEach((l2) => {
          if (!loaded[l2]) loaded[l2] = {};
          const loadedKeys = q2.loaded[l2];
          if (loadedKeys.length) {
            loadedKeys.forEach((n2) => {
              if (loaded[l2][n2] === void 0) loaded[l2][n2] = true;
            });
          }
        });
        q2.done = true;
        if (q2.errors.length) {
          q2.callback(q2.errors);
        } else {
          q2.callback();
        }
      }
    });
    this.emit("loaded", loaded);
    this.queue = this.queue.filter((q2) => !q2.done);
  }
  read(lng, ns, fcName, tried = 0, wait = this.retryTimeout, callback) {
    if (!lng.length) return callback(null, {});
    if (this.readingCalls >= this.maxParallelReads) {
      this.waitingReads.push({
        lng,
        ns,
        fcName,
        tried,
        wait,
        callback
      });
      return;
    }
    this.readingCalls++;
    const resolver = (err, data) => {
      this.readingCalls--;
      if (this.waitingReads.length > 0) {
        const next = this.waitingReads.shift();
        this.read(next.lng, next.ns, next.fcName, next.tried, next.wait, next.callback);
      }
      if (err && data && tried < this.maxRetries) {
        setTimeout(() => {
          this.read.call(this, lng, ns, fcName, tried + 1, wait * 2, callback);
        }, wait);
        return;
      }
      callback(err, data);
    };
    const fc2 = this.backend[fcName].bind(this.backend);
    if (fc2.length === 2) {
      try {
        const r2 = fc2(lng, ns);
        if (r2 && typeof r2.then === "function") {
          r2.then((data) => resolver(null, data)).catch(resolver);
        } else {
          resolver(null, r2);
        }
      } catch (err) {
        resolver(err);
      }
      return;
    }
    return fc2(lng, ns, resolver);
  }
  prepareLoading(languages, namespaces, options = {}, callback) {
    if (!this.backend) {
      this.logger.warn("No backend was added via i18next.use. Will not load resources.");
      return callback && callback();
    }
    if (isString$1(languages)) languages = this.languageUtils.toResolveHierarchy(languages);
    if (isString$1(namespaces)) namespaces = [namespaces];
    const toLoad = this.queueLoad(languages, namespaces, options, callback);
    if (!toLoad.toLoad.length) {
      if (!toLoad.pending.length) callback();
      return null;
    }
    toLoad.toLoad.forEach((name) => {
      this.loadOne(name);
    });
  }
  load(languages, namespaces, callback) {
    this.prepareLoading(languages, namespaces, {}, callback);
  }
  reload(languages, namespaces, callback) {
    this.prepareLoading(languages, namespaces, {
      reload: true
    }, callback);
  }
  loadOne(name, prefix = "") {
    const s = name.split("|");
    const lng = s[0];
    const ns = s[1];
    this.read(lng, ns, "read", void 0, void 0, (err, data) => {
      if (err) this.logger.warn(`${prefix}loading namespace ${ns} for language ${lng} failed`, err);
      if (!err && data) this.logger.log(`${prefix}loaded namespace ${ns} for language ${lng}`, data);
      this.loaded(name, err, data);
    });
  }
  saveMissing(languages, namespace, key, fallbackValue, isUpdate, options = {}, clb = () => {
  }) {
    if (this.services?.utils?.hasLoadedNamespace && !this.services?.utils?.hasLoadedNamespace(namespace)) {
      this.logger.warn(`did not save key "${key}" as the namespace "${namespace}" was not yet loaded`, "This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!");
      return;
    }
    if (key === void 0 || key === null || key === "") return;
    if (this.backend?.create) {
      const opts = {
        ...options,
        isUpdate
      };
      const fc2 = this.backend.create.bind(this.backend);
      if (fc2.length < 6) {
        try {
          let r2;
          if (fc2.length === 5) {
            r2 = fc2(languages, namespace, key, fallbackValue, opts);
          } else {
            r2 = fc2(languages, namespace, key, fallbackValue);
          }
          if (r2 && typeof r2.then === "function") {
            r2.then((data) => clb(null, data)).catch(clb);
          } else {
            clb(null, r2);
          }
        } catch (err) {
          clb(err);
        }
      } else {
        fc2(languages, namespace, key, fallbackValue, clb, opts);
      }
    }
    if (!languages || !languages[0]) return;
    this.store.addResource(languages[0], namespace, key, fallbackValue);
  }
}
const get = () => ({
  debug: false,
  initAsync: true,
  ns: ["translation"],
  defaultNS: ["translation"],
  fallbackLng: ["dev"],
  fallbackNS: false,
  supportedLngs: false,
  nonExplicitSupportedLngs: false,
  load: "all",
  preload: false,
  simplifyPluralSuffix: true,
  keySeparator: ".",
  nsSeparator: ":",
  pluralSeparator: "_",
  contextSeparator: "_",
  partialBundledLanguages: false,
  saveMissing: false,
  updateMissing: false,
  saveMissingTo: "fallback",
  saveMissingPlurals: true,
  missingKeyHandler: false,
  missingInterpolationHandler: false,
  postProcess: false,
  postProcessPassResolved: false,
  returnNull: false,
  returnEmptyString: true,
  returnObjects: false,
  joinArrays: false,
  returnedObjectHandler: false,
  parseMissingKeyHandler: false,
  appendNamespaceToMissingKey: false,
  appendNamespaceToCIMode: false,
  overloadTranslationOptionHandler: (args) => {
    let ret = {};
    if (typeof args[1] === "object") ret = args[1];
    if (isString$1(args[1])) ret.defaultValue = args[1];
    if (isString$1(args[2])) ret.tDescription = args[2];
    if (typeof args[2] === "object" || typeof args[3] === "object") {
      const options = args[3] || args[2];
      Object.keys(options).forEach((key) => {
        ret[key] = options[key];
      });
    }
    return ret;
  },
  interpolation: {
    escapeValue: true,
    format: (value) => value,
    prefix: "{{",
    suffix: "}}",
    formatSeparator: ",",
    unescapePrefix: "-",
    nestingPrefix: "$t(",
    nestingSuffix: ")",
    nestingOptionsSeparator: ",",
    maxReplaces: 1e3,
    skipOnVariables: true
  },
  cacheInBuiltFormats: true
});
const transformOptions = (options) => {
  if (isString$1(options.ns)) options.ns = [options.ns];
  if (isString$1(options.fallbackLng)) options.fallbackLng = [options.fallbackLng];
  if (isString$1(options.fallbackNS)) options.fallbackNS = [options.fallbackNS];
  if (options.supportedLngs?.indexOf?.("cimode") < 0) {
    options.supportedLngs = options.supportedLngs.concat(["cimode"]);
  }
  if (typeof options.initImmediate === "boolean") options.initAsync = options.initImmediate;
  return options;
};
const noop = () => {
};
const bindMemberFunctions = (inst) => {
  const mems = Object.getOwnPropertyNames(Object.getPrototypeOf(inst));
  mems.forEach((mem) => {
    if (typeof inst[mem] === "function") {
      inst[mem] = inst[mem].bind(inst);
    }
  });
};
let supportNoticeShown = false;
const usesLocize = (inst) => {
  if (inst?.modules?.backend?.name?.indexOf("Locize") > 0) return true;
  if (inst?.modules?.backend?.constructor?.name?.indexOf("Locize") > 0) return true;
  if (inst?.options?.backend?.backends) {
    if (inst.options.backend.backends.some((b) => b?.name?.indexOf("Locize") > 0 || b?.constructor?.name?.indexOf("Locize") > 0)) return true;
  }
  return false;
};
class I18n extends EventEmitter {
  constructor(options = {}, callback) {
    super();
    this.options = transformOptions(options);
    this.services = {};
    this.logger = baseLogger;
    this.modules = {
      external: []
    };
    bindMemberFunctions(this);
    if (callback && !this.isInitialized && !options.isClone) {
      if (!this.options.initAsync) {
        this.init(options, callback);
        return this;
      }
      setTimeout(() => {
        this.init(options, callback);
      }, 0);
    }
  }
  init(options = {}, callback) {
    this.isInitializing = true;
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (options.defaultNS == null && options.ns) {
      if (isString$1(options.ns)) {
        options.defaultNS = options.ns;
      } else if (options.ns.indexOf("translation") < 0) {
        options.defaultNS = options.ns[0];
      }
    }
    const defOpts = get();
    this.options = {
      ...defOpts,
      ...this.options,
      ...transformOptions(options)
    };
    this.options.interpolation = {
      ...defOpts.interpolation,
      ...this.options.interpolation
    };
    if (options.keySeparator !== void 0) {
      this.options.userDefinedKeySeparator = options.keySeparator;
    }
    if (options.nsSeparator !== void 0) {
      this.options.userDefinedNsSeparator = options.nsSeparator;
    }
    if (typeof this.options.overloadTranslationOptionHandler !== "function") {
      this.options.overloadTranslationOptionHandler = defOpts.overloadTranslationOptionHandler;
    }
    if (this.options.showSupportNotice !== false && !usesLocize(this) && !supportNoticeShown) {
      if (typeof console !== "undefined" && typeof console.info !== "undefined") console.info("🌐 i18next is maintained with support from Locize — consider powering your project with managed localization (AI, CDN, integrations): https://locize.com 💙");
      supportNoticeShown = true;
    }
    const createClassOnDemand = (ClassOrObject) => {
      if (!ClassOrObject) return null;
      if (typeof ClassOrObject === "function") return new ClassOrObject();
      return ClassOrObject;
    };
    if (!this.options.isClone) {
      if (this.modules.logger) {
        baseLogger.init(createClassOnDemand(this.modules.logger), this.options);
      } else {
        baseLogger.init(null, this.options);
      }
      let formatter;
      if (this.modules.formatter) {
        formatter = this.modules.formatter;
      } else {
        formatter = Formatter;
      }
      const lu = new LanguageUtil(this.options);
      this.store = new ResourceStore(this.options.resources, this.options);
      const s = this.services;
      s.logger = baseLogger;
      s.resourceStore = this.store;
      s.languageUtils = lu;
      s.pluralResolver = new PluralResolver(lu, {
        prepend: this.options.pluralSeparator,
        simplifyPluralSuffix: this.options.simplifyPluralSuffix
      });
      const usingLegacyFormatFunction = this.options.interpolation.format && this.options.interpolation.format !== defOpts.interpolation.format;
      if (usingLegacyFormatFunction) {
        this.logger.deprecate(`init: you are still using the legacy format function, please use the new approach: https://www.i18next.com/translation-function/formatting`);
      }
      if (formatter && (!this.options.interpolation.format || this.options.interpolation.format === defOpts.interpolation.format)) {
        s.formatter = createClassOnDemand(formatter);
        if (s.formatter.init) s.formatter.init(s, this.options);
        this.options.interpolation.format = s.formatter.format.bind(s.formatter);
      }
      s.interpolator = new Interpolator(this.options);
      s.utils = {
        hasLoadedNamespace: this.hasLoadedNamespace.bind(this)
      };
      s.backendConnector = new Connector(createClassOnDemand(this.modules.backend), s.resourceStore, s, this.options);
      s.backendConnector.on("*", (event, ...args) => {
        this.emit(event, ...args);
      });
      if (this.modules.languageDetector) {
        s.languageDetector = createClassOnDemand(this.modules.languageDetector);
        if (s.languageDetector.init) s.languageDetector.init(s, this.options.detection, this.options);
      }
      if (this.modules.i18nFormat) {
        s.i18nFormat = createClassOnDemand(this.modules.i18nFormat);
        if (s.i18nFormat.init) s.i18nFormat.init(this);
      }
      this.translator = new Translator(this.services, this.options);
      this.translator.on("*", (event, ...args) => {
        this.emit(event, ...args);
      });
      this.modules.external.forEach((m2) => {
        if (m2.init) m2.init(this);
      });
    }
    this.format = this.options.interpolation.format;
    if (!callback) callback = noop;
    if (this.options.fallbackLng && !this.services.languageDetector && !this.options.lng) {
      const codes = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
      if (codes.length > 0 && codes[0] !== "dev") this.options.lng = codes[0];
    }
    if (!this.services.languageDetector && !this.options.lng) {
      this.logger.warn("init: no languageDetector is used and no lng is defined");
    }
    const storeApi = ["getResource", "hasResourceBundle", "getResourceBundle", "getDataByLanguage"];
    storeApi.forEach((fcName) => {
      this[fcName] = (...args) => this.store[fcName](...args);
    });
    const storeApiChained = ["addResource", "addResources", "addResourceBundle", "removeResourceBundle"];
    storeApiChained.forEach((fcName) => {
      this[fcName] = (...args) => {
        this.store[fcName](...args);
        return this;
      };
    });
    const deferred = defer();
    const load = () => {
      const finish = (err, t2) => {
        this.isInitializing = false;
        if (this.isInitialized && !this.initializedStoreOnce) this.logger.warn("init: i18next is already initialized. You should call init just once!");
        this.isInitialized = true;
        if (!this.options.isClone) this.logger.log("initialized", this.options);
        this.emit("initialized", this.options);
        deferred.resolve(t2);
        callback(err, t2);
      };
      if (this.languages && !this.isInitialized) return finish(null, this.t.bind(this));
      this.changeLanguage(this.options.lng, finish);
    };
    if (this.options.resources || !this.options.initAsync) {
      load();
    } else {
      setTimeout(load, 0);
    }
    return deferred;
  }
  loadResources(language, callback = noop) {
    let usedCallback = callback;
    const usedLng = isString$1(language) ? language : this.language;
    if (typeof language === "function") usedCallback = language;
    if (!this.options.resources || this.options.partialBundledLanguages) {
      if (usedLng?.toLowerCase() === "cimode" && (!this.options.preload || this.options.preload.length === 0)) return usedCallback();
      const toLoad = [];
      const append = (lng) => {
        if (!lng) return;
        if (lng === "cimode") return;
        const lngs = this.services.languageUtils.toResolveHierarchy(lng);
        lngs.forEach((l2) => {
          if (l2 === "cimode") return;
          if (toLoad.indexOf(l2) < 0) toLoad.push(l2);
        });
      };
      if (!usedLng) {
        const fallbacks = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
        fallbacks.forEach((l2) => append(l2));
      } else {
        append(usedLng);
      }
      this.options.preload?.forEach?.((l2) => append(l2));
      this.services.backendConnector.load(toLoad, this.options.ns, (e) => {
        if (!e && !this.resolvedLanguage && this.language) this.setResolvedLanguage(this.language);
        usedCallback(e);
      });
    } else {
      usedCallback(null);
    }
  }
  reloadResources(lngs, ns, callback) {
    const deferred = defer();
    if (typeof lngs === "function") {
      callback = lngs;
      lngs = void 0;
    }
    if (typeof ns === "function") {
      callback = ns;
      ns = void 0;
    }
    if (!lngs) lngs = this.languages;
    if (!ns) ns = this.options.ns;
    if (!callback) callback = noop;
    this.services.backendConnector.reload(lngs, ns, (err) => {
      deferred.resolve();
      callback(err);
    });
    return deferred;
  }
  use(module) {
    if (!module) throw new Error("You are passing an undefined module! Please check the object you are passing to i18next.use()");
    if (!module.type) throw new Error("You are passing a wrong module! Please check the object you are passing to i18next.use()");
    if (module.type === "backend") {
      this.modules.backend = module;
    }
    if (module.type === "logger" || module.log && module.warn && module.error) {
      this.modules.logger = module;
    }
    if (module.type === "languageDetector") {
      this.modules.languageDetector = module;
    }
    if (module.type === "i18nFormat") {
      this.modules.i18nFormat = module;
    }
    if (module.type === "postProcessor") {
      postProcessor.addPostProcessor(module);
    }
    if (module.type === "formatter") {
      this.modules.formatter = module;
    }
    if (module.type === "3rdParty") {
      this.modules.external.push(module);
    }
    return this;
  }
  setResolvedLanguage(l2) {
    if (!l2 || !this.languages) return;
    if (["cimode", "dev"].indexOf(l2) > -1) return;
    for (let li2 = 0; li2 < this.languages.length; li2++) {
      const lngInLngs = this.languages[li2];
      if (["cimode", "dev"].indexOf(lngInLngs) > -1) continue;
      if (this.store.hasLanguageSomeTranslations(lngInLngs)) {
        this.resolvedLanguage = lngInLngs;
        break;
      }
    }
    if (!this.resolvedLanguage && this.languages.indexOf(l2) < 0 && this.store.hasLanguageSomeTranslations(l2)) {
      this.resolvedLanguage = l2;
      this.languages.unshift(l2);
    }
  }
  changeLanguage(lng, callback) {
    this.isLanguageChangingTo = lng;
    const deferred = defer();
    this.emit("languageChanging", lng);
    const setLngProps = (l2) => {
      this.language = l2;
      this.languages = this.services.languageUtils.toResolveHierarchy(l2);
      this.resolvedLanguage = void 0;
      this.setResolvedLanguage(l2);
    };
    const done = (err, l2) => {
      if (l2) {
        if (this.isLanguageChangingTo === lng) {
          setLngProps(l2);
          this.translator.changeLanguage(l2);
          this.isLanguageChangingTo = void 0;
          this.emit("languageChanged", l2);
          this.logger.log("languageChanged", l2);
        }
      } else {
        this.isLanguageChangingTo = void 0;
      }
      deferred.resolve((...args) => this.t(...args));
      if (callback) callback(err, (...args) => this.t(...args));
    };
    const setLng = (lngs) => {
      if (!lng && !lngs && this.services.languageDetector) lngs = [];
      const fl2 = isString$1(lngs) ? lngs : lngs && lngs[0];
      const l2 = this.store.hasLanguageSomeTranslations(fl2) ? fl2 : this.services.languageUtils.getBestMatchFromCodes(isString$1(lngs) ? [lngs] : lngs);
      if (l2) {
        if (!this.language) {
          setLngProps(l2);
        }
        if (!this.translator.language) this.translator.changeLanguage(l2);
        this.services.languageDetector?.cacheUserLanguage?.(l2);
      }
      this.loadResources(l2, (err) => {
        done(err, l2);
      });
    };
    if (!lng && this.services.languageDetector && !this.services.languageDetector.async) {
      setLng(this.services.languageDetector.detect());
    } else if (!lng && this.services.languageDetector && this.services.languageDetector.async) {
      if (this.services.languageDetector.detect.length === 0) {
        this.services.languageDetector.detect().then(setLng);
      } else {
        this.services.languageDetector.detect(setLng);
      }
    } else {
      setLng(lng);
    }
    return deferred;
  }
  getFixedT(lng, ns, keyPrefix) {
    const fixedT = (key, opts, ...rest) => {
      let o;
      if (typeof opts !== "object") {
        o = this.options.overloadTranslationOptionHandler([key, opts].concat(rest));
      } else {
        o = {
          ...opts
        };
      }
      o.lng = o.lng || fixedT.lng;
      o.lngs = o.lngs || fixedT.lngs;
      o.ns = o.ns || fixedT.ns;
      if (o.keyPrefix !== "") o.keyPrefix = o.keyPrefix || keyPrefix || fixedT.keyPrefix;
      const keySeparator = this.options.keySeparator || ".";
      let resultKey;
      if (o.keyPrefix && Array.isArray(key)) {
        resultKey = key.map((k2) => {
          if (typeof k2 === "function") k2 = keysFromSelector(k2, {
            ...this.options,
            ...opts
          });
          return `${o.keyPrefix}${keySeparator}${k2}`;
        });
      } else {
        if (typeof key === "function") key = keysFromSelector(key, {
          ...this.options,
          ...opts
        });
        resultKey = o.keyPrefix ? `${o.keyPrefix}${keySeparator}${key}` : key;
      }
      return this.t(resultKey, o);
    };
    if (isString$1(lng)) {
      fixedT.lng = lng;
    } else {
      fixedT.lngs = lng;
    }
    fixedT.ns = ns;
    fixedT.keyPrefix = keyPrefix;
    return fixedT;
  }
  t(...args) {
    return this.translator?.translate(...args);
  }
  exists(...args) {
    return this.translator?.exists(...args);
  }
  setDefaultNamespace(ns) {
    this.options.defaultNS = ns;
  }
  hasLoadedNamespace(ns, options = {}) {
    if (!this.isInitialized) {
      this.logger.warn("hasLoadedNamespace: i18next was not initialized", this.languages);
      return false;
    }
    if (!this.languages || !this.languages.length) {
      this.logger.warn("hasLoadedNamespace: i18n.languages were undefined or empty", this.languages);
      return false;
    }
    const lng = options.lng || this.resolvedLanguage || this.languages[0];
    const fallbackLng = this.options ? this.options.fallbackLng : false;
    const lastLng = this.languages[this.languages.length - 1];
    if (lng.toLowerCase() === "cimode") return true;
    const loadNotPending = (l2, n2) => {
      const loadState = this.services.backendConnector.state[`${l2}|${n2}`];
      return loadState === -1 || loadState === 0 || loadState === 2;
    };
    if (options.precheck) {
      const preResult = options.precheck(this, loadNotPending);
      if (preResult !== void 0) return preResult;
    }
    if (this.hasResourceBundle(lng, ns)) return true;
    if (!this.services.backendConnector.backend || this.options.resources && !this.options.partialBundledLanguages) return true;
    if (loadNotPending(lng, ns) && (!fallbackLng || loadNotPending(lastLng, ns))) return true;
    return false;
  }
  loadNamespaces(ns, callback) {
    const deferred = defer();
    if (!this.options.ns) {
      if (callback) callback();
      return Promise.resolve();
    }
    if (isString$1(ns)) ns = [ns];
    ns.forEach((n2) => {
      if (this.options.ns.indexOf(n2) < 0) this.options.ns.push(n2);
    });
    this.loadResources((err) => {
      deferred.resolve();
      if (callback) callback(err);
    });
    return deferred;
  }
  loadLanguages(lngs, callback) {
    const deferred = defer();
    if (isString$1(lngs)) lngs = [lngs];
    const preloaded = this.options.preload || [];
    const newLngs = lngs.filter((lng) => preloaded.indexOf(lng) < 0 && this.services.languageUtils.isSupportedCode(lng));
    if (!newLngs.length) {
      if (callback) callback();
      return Promise.resolve();
    }
    this.options.preload = preloaded.concat(newLngs);
    this.loadResources((err) => {
      deferred.resolve();
      if (callback) callback(err);
    });
    return deferred;
  }
  dir(lng) {
    if (!lng) lng = this.resolvedLanguage || (this.languages?.length > 0 ? this.languages[0] : this.language);
    if (!lng) return "rtl";
    try {
      const l2 = new Intl.Locale(lng);
      if (l2 && l2.getTextInfo) {
        const ti2 = l2.getTextInfo();
        if (ti2 && ti2.direction) return ti2.direction;
      }
    } catch (e) {
    }
    const rtlLngs = ["ar", "shu", "sqr", "ssh", "xaa", "yhd", "yud", "aao", "abh", "abv", "acm", "acq", "acw", "acx", "acy", "adf", "ads", "aeb", "aec", "afb", "ajp", "apc", "apd", "arb", "arq", "ars", "ary", "arz", "auz", "avl", "ayh", "ayl", "ayn", "ayp", "bbz", "pga", "he", "iw", "ps", "pbt", "pbu", "pst", "prp", "prd", "ug", "ur", "ydd", "yds", "yih", "ji", "yi", "hbo", "men", "xmn", "fa", "jpr", "peo", "pes", "prs", "dv", "sam", "ckb"];
    const languageUtils = this.services?.languageUtils || new LanguageUtil(get());
    if (lng.toLowerCase().indexOf("-latn") > 1) return "ltr";
    return rtlLngs.indexOf(languageUtils.getLanguagePartFromCode(lng)) > -1 || lng.toLowerCase().indexOf("-arab") > 1 ? "rtl" : "ltr";
  }
  static createInstance(options = {}, callback) {
    const instance2 = new I18n(options, callback);
    instance2.createInstance = I18n.createInstance;
    return instance2;
  }
  cloneInstance(options = {}, callback = noop) {
    const forkResourceStore = options.forkResourceStore;
    if (forkResourceStore) delete options.forkResourceStore;
    const mergedOptions = {
      ...this.options,
      ...options,
      ...{
        isClone: true
      }
    };
    const clone = new I18n(mergedOptions);
    if (options.debug !== void 0 || options.prefix !== void 0) {
      clone.logger = clone.logger.clone(options);
    }
    const membersToCopy = ["store", "services", "language"];
    membersToCopy.forEach((m2) => {
      clone[m2] = this[m2];
    });
    clone.services = {
      ...this.services
    };
    clone.services.utils = {
      hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
    };
    if (forkResourceStore) {
      const clonedData = Object.keys(this.store.data).reduce((prev, l2) => {
        prev[l2] = {
          ...this.store.data[l2]
        };
        prev[l2] = Object.keys(prev[l2]).reduce((acc, n2) => {
          acc[n2] = {
            ...prev[l2][n2]
          };
          return acc;
        }, prev[l2]);
        return prev;
      }, {});
      clone.store = new ResourceStore(clonedData, mergedOptions);
      clone.services.resourceStore = clone.store;
    }
    if (options.interpolation) {
      const defOpts = get();
      const mergedInterpolation = {
        ...defOpts.interpolation,
        ...this.options.interpolation,
        ...options.interpolation
      };
      const mergedForInterpolator = {
        ...mergedOptions,
        interpolation: mergedInterpolation
      };
      clone.services.interpolator = new Interpolator(mergedForInterpolator);
    }
    clone.translator = new Translator(clone.services, mergedOptions);
    clone.translator.on("*", (event, ...args) => {
      clone.emit(event, ...args);
    });
    clone.init(mergedOptions, callback);
    clone.translator.options = mergedOptions;
    clone.translator.backendConnector.services.utils = {
      hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
    };
    return clone;
  }
  toJSON() {
    return {
      options: this.options,
      store: this.store,
      language: this.language,
      languages: this.languages,
      resolvedLanguage: this.resolvedLanguage
    };
  }
}
const instance = I18n.createInstance();
instance.createInstance;
instance.dir;
instance.init;
instance.loadResources;
instance.reloadResources;
instance.use;
instance.changeLanguage;
instance.getFixedT;
instance.t;
instance.exists;
instance.setDefaultNamespace;
instance.hasLoadedNamespace;
instance.loadNamespaces;
instance.loadLanguages;
const warn = (i18n, code, msg, rest) => {
  const args = [msg, {
    code,
    ...rest || {}
  }];
  if (i18n?.services?.logger?.forward) {
    return i18n.services.logger.forward(args, "warn", "react-i18next::", true);
  }
  if (isString(args[0])) args[0] = `react-i18next:: ${args[0]}`;
  if (i18n?.services?.logger?.warn) {
    i18n.services.logger.warn(...args);
  } else if (console?.warn) {
    console.warn(...args);
  }
};
const alreadyWarned = {};
const warnOnce = (i18n, code, msg, rest) => {
  if (isString(msg) && alreadyWarned[msg]) return;
  if (isString(msg)) alreadyWarned[msg] = /* @__PURE__ */ new Date();
  warn(i18n, code, msg, rest);
};
const loadedClb = (i18n, cb2) => () => {
  if (i18n.isInitialized) {
    cb2();
  } else {
    const initialized = () => {
      setTimeout(() => {
        i18n.off("initialized", initialized);
      }, 0);
      cb2();
    };
    i18n.on("initialized", initialized);
  }
};
const loadNamespaces = (i18n, ns, cb2) => {
  i18n.loadNamespaces(ns, loadedClb(i18n, cb2));
};
const loadLanguages = (i18n, lng, ns, cb2) => {
  if (isString(ns)) ns = [ns];
  if (i18n.options.preload && i18n.options.preload.indexOf(lng) > -1) return loadNamespaces(i18n, ns, cb2);
  ns.forEach((n2) => {
    if (i18n.options.ns.indexOf(n2) < 0) i18n.options.ns.push(n2);
  });
  i18n.loadLanguages(lng, loadedClb(i18n, cb2));
};
const hasLoadedNamespace = (ns, i18n, options = {}) => {
  if (!i18n.languages || !i18n.languages.length) {
    warnOnce(i18n, "NO_LANGUAGES", "i18n.languages were undefined or empty", {
      languages: i18n.languages
    });
    return true;
  }
  return i18n.hasLoadedNamespace(ns, {
    lng: options.lng,
    precheck: (i18nInstance2, loadNotPending) => {
      if (options.bindI18n && options.bindI18n.indexOf("languageChanging") > -1 && i18nInstance2.services.backendConnector.backend && i18nInstance2.isLanguageChangingTo && !loadNotPending(i18nInstance2.isLanguageChangingTo, ns)) return false;
    }
  });
};
const isString = (obj) => typeof obj === "string";
const isObject = (obj) => typeof obj === "object" && obj !== null;
const matchHtmlEntity = /&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34|nbsp|#160|copy|#169|reg|#174|hellip|#8230|#x2F|#47);/g;
const htmlEntities = {
  "&amp;": "&",
  "&#38;": "&",
  "&lt;": "<",
  "&#60;": "<",
  "&gt;": ">",
  "&#62;": ">",
  "&apos;": "'",
  "&#39;": "'",
  "&quot;": '"',
  "&#34;": '"',
  "&nbsp;": " ",
  "&#160;": " ",
  "&copy;": "©",
  "&#169;": "©",
  "&reg;": "®",
  "&#174;": "®",
  "&hellip;": "…",
  "&#8230;": "…",
  "&#x2F;": "/",
  "&#47;": "/"
};
const unescapeHtmlEntity = (m2) => htmlEntities[m2];
const unescape = (text) => text.replace(matchHtmlEntity, unescapeHtmlEntity);
let defaultOptions = {
  bindI18n: "languageChanged",
  bindI18nStore: "",
  transEmptyNodeValue: "",
  transSupportBasicHtmlNodes: true,
  transWrapTextNodes: "",
  transKeepBasicHtmlNodesFor: ["br", "strong", "i", "p"],
  useSuspense: true,
  unescape,
  transDefaultProps: void 0
};
const setDefaults = (options = {}) => {
  defaultOptions = {
    ...defaultOptions,
    ...options
  };
};
const getDefaults$1 = () => defaultOptions;
let i18nInstance;
const setI18n = (instance2) => {
  i18nInstance = instance2;
};
const getI18n = () => i18nInstance;
const initReactI18next = {
  type: "3rdParty",
  init(instance2) {
    setDefaults(instance2.options.react);
    setI18n(instance2);
  }
};
const I18nContext = reactExports.createContext();
class ReportNamespaces {
  constructor() {
    this.usedNamespaces = {};
  }
  addUsedNamespaces(namespaces) {
    namespaces.forEach((ns) => {
      if (!this.usedNamespaces[ns]) this.usedNamespaces[ns] = true;
    });
  }
  getUsedNamespaces() {
    return Object.keys(this.usedNamespaces);
  }
}
var shim$1 = { exports: {} };
var useSyncExternalStoreShim_production = {};
/**
 * @license React
 * use-sync-external-store-shim.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var React = reactExports;
function is(x2, y2) {
  return x2 === y2 && (0 !== x2 || 1 / x2 === 1 / y2) || x2 !== x2 && y2 !== y2;
}
var objectIs = "function" === typeof Object.is ? Object.is : is, useState = React.useState, useEffect = React.useEffect, useLayoutEffect = React.useLayoutEffect, useDebugValue = React.useDebugValue;
function useSyncExternalStore$2(subscribe, getSnapshot) {
  var value = getSnapshot(), _useState = useState({ inst: { value, getSnapshot } }), inst = _useState[0].inst, forceUpdate = _useState[1];
  useLayoutEffect(
    function() {
      inst.value = value;
      inst.getSnapshot = getSnapshot;
      checkIfSnapshotChanged(inst) && forceUpdate({ inst });
    },
    [subscribe, value, getSnapshot]
  );
  useEffect(
    function() {
      checkIfSnapshotChanged(inst) && forceUpdate({ inst });
      return subscribe(function() {
        checkIfSnapshotChanged(inst) && forceUpdate({ inst });
      });
    },
    [subscribe]
  );
  useDebugValue(value);
  return value;
}
function checkIfSnapshotChanged(inst) {
  var latestGetSnapshot = inst.getSnapshot;
  inst = inst.value;
  try {
    var nextValue = latestGetSnapshot();
    return !objectIs(inst, nextValue);
  } catch (error) {
    return true;
  }
}
function useSyncExternalStore$1(subscribe, getSnapshot) {
  return getSnapshot();
}
var shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
useSyncExternalStoreShim_production.useSyncExternalStore = void 0 !== React.useSyncExternalStore ? React.useSyncExternalStore : shim;
{
  shim$1.exports = useSyncExternalStoreShim_production;
}
var shimExports = shim$1.exports;
const notReadyT = (k2, optsOrDefaultValue) => {
  if (isString(optsOrDefaultValue)) return optsOrDefaultValue;
  if (isObject(optsOrDefaultValue) && isString(optsOrDefaultValue.defaultValue)) return optsOrDefaultValue.defaultValue;
  return Array.isArray(k2) ? k2[k2.length - 1] : k2;
};
const notReadySnapshot = {
  t: notReadyT,
  ready: false
};
const dummySubscribe = () => () => {
};
const useTranslation = (ns, props = {}) => {
  const {
    i18n: i18nFromProps
  } = props;
  const {
    i18n: i18nFromContext,
    defaultNS: defaultNSFromContext
  } = reactExports.useContext(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  if (i18n && !i18n.reportNamespaces) i18n.reportNamespaces = new ReportNamespaces();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", "useTranslation: You will need to pass in an i18next instance by using initReactI18next");
  }
  const i18nOptions = reactExports.useMemo(() => ({
    ...getDefaults$1(),
    ...i18n?.options?.react,
    ...props
  }), [i18n, props]);
  const {
    useSuspense,
    keyPrefix
  } = i18nOptions;
  const nsOrContext = defaultNSFromContext || i18n?.options?.defaultNS;
  const unstableNamespaces = isString(nsOrContext) ? [nsOrContext] : nsOrContext || ["translation"];
  const namespaces = reactExports.useMemo(() => unstableNamespaces, unstableNamespaces);
  i18n?.reportNamespaces?.addUsedNamespaces?.(namespaces);
  const revisionRef = reactExports.useRef(0);
  const subscribe = reactExports.useCallback((callback) => {
    if (!i18n) return dummySubscribe;
    const {
      bindI18n,
      bindI18nStore
    } = i18nOptions;
    const wrappedCallback = () => {
      revisionRef.current += 1;
      callback();
    };
    if (bindI18n) i18n.on(bindI18n, wrappedCallback);
    if (bindI18nStore) i18n.store.on(bindI18nStore, wrappedCallback);
    return () => {
      if (bindI18n) bindI18n.split(" ").forEach((e) => i18n.off(e, wrappedCallback));
      if (bindI18nStore) bindI18nStore.split(" ").forEach((e) => i18n.store.off(e, wrappedCallback));
    };
  }, [i18n, i18nOptions]);
  const snapshotRef = reactExports.useRef();
  const getSnapshot = reactExports.useCallback(() => {
    if (!i18n) {
      return notReadySnapshot;
    }
    const calculatedReady = !!(i18n.isInitialized || i18n.initializedStoreOnce) && namespaces.every((n2) => hasLoadedNamespace(n2, i18n, i18nOptions));
    const currentLng = props.lng || i18n.language;
    const currentRevision = revisionRef.current;
    const lastSnapshot = snapshotRef.current;
    if (lastSnapshot && lastSnapshot.ready === calculatedReady && lastSnapshot.lng === currentLng && lastSnapshot.keyPrefix === keyPrefix && lastSnapshot.revision === currentRevision) {
      return lastSnapshot;
    }
    const calculatedT = i18n.getFixedT(currentLng, i18nOptions.nsMode === "fallback" ? namespaces : namespaces[0], keyPrefix);
    const newSnapshot = {
      t: calculatedT,
      ready: calculatedReady,
      lng: currentLng,
      keyPrefix,
      revision: currentRevision
    };
    snapshotRef.current = newSnapshot;
    return newSnapshot;
  }, [i18n, namespaces, keyPrefix, i18nOptions, props.lng]);
  const [loadCount, setLoadCount] = reactExports.useState(0);
  const {
    t: t2,
    ready
  } = shimExports.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  reactExports.useEffect(() => {
    if (i18n && !ready && !useSuspense) {
      const onLoaded = () => setLoadCount((c) => c + 1);
      if (props.lng) {
        loadLanguages(i18n, props.lng, namespaces, onLoaded);
      } else {
        loadNamespaces(i18n, namespaces, onLoaded);
      }
    }
  }, [i18n, props.lng, namespaces, ready, useSuspense, loadCount]);
  const finalI18n = i18n || {};
  const wrapperRef = reactExports.useRef(null);
  const wrapperLangRef = reactExports.useRef();
  const createI18nWrapper = (original) => {
    const descriptors = Object.getOwnPropertyDescriptors(original);
    if (descriptors.__original) delete descriptors.__original;
    const wrapper = Object.create(Object.getPrototypeOf(original), descriptors);
    if (!Object.prototype.hasOwnProperty.call(wrapper, "__original")) {
      try {
        Object.defineProperty(wrapper, "__original", {
          value: original,
          writable: false,
          enumerable: false,
          configurable: false
        });
      } catch (_) {
      }
    }
    return wrapper;
  };
  const ret = reactExports.useMemo(() => {
    const original = finalI18n;
    const lang = original?.language;
    let i18nWrapper = original;
    if (original) {
      if (wrapperRef.current && wrapperRef.current.__original === original) {
        if (wrapperLangRef.current !== lang) {
          i18nWrapper = createI18nWrapper(original);
          wrapperRef.current = i18nWrapper;
          wrapperLangRef.current = lang;
        } else {
          i18nWrapper = wrapperRef.current;
        }
      } else {
        i18nWrapper = createI18nWrapper(original);
        wrapperRef.current = i18nWrapper;
        wrapperLangRef.current = lang;
      }
    }
    const arr = [t2, i18nWrapper, ready];
    arr.t = t2;
    arr.i18n = i18nWrapper;
    arr.ready = ready;
    return arr;
  }, [t2, finalI18n, ready, finalI18n.resolvedLanguage, finalI18n.language, finalI18n.languages]);
  if (i18n && useSuspense && !ready) {
    throw new Promise((resolve) => {
      const onLoaded = () => resolve();
      if (props.lng) {
        loadLanguages(i18n, props.lng, namespaces, onLoaded);
      } else {
        loadNamespaces(i18n, namespaces, onLoaded);
      }
    });
  }
  return ret;
};
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Icon = reactExports.forwardRef(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return reactExports.createElement(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => reactExports.createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const createLucideIcon = (iconName, iconNode) => {
  const Component = reactExports.forwardRef(
    ({ className, ...props }, ref) => reactExports.createElement(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Boxes = createLucideIcon("Boxes", [
  [
    "path",
    {
      d: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z",
      key: "lc1i9w"
    }
  ],
  ["path", { d: "m7 16.5-4.74-2.85", key: "1o9zyk" }],
  ["path", { d: "m7 16.5 5-3", key: "va8pkn" }],
  ["path", { d: "M7 16.5v5.17", key: "jnp8gn" }],
  [
    "path",
    {
      d: "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z",
      key: "8zsnat"
    }
  ],
  ["path", { d: "m17 16.5-5-3", key: "8arw3v" }],
  ["path", { d: "m17 16.5 4.74-2.85", key: "8rfmw" }],
  ["path", { d: "M17 16.5v5.17", key: "k6z78m" }],
  [
    "path",
    {
      d: "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z",
      key: "1xygjf"
    }
  ],
  ["path", { d: "M12 8 7.26 5.15", key: "1vbdud" }],
  ["path", { d: "m12 8 4.74-2.85", key: "3rx089" }],
  ["path", { d: "M12 13.5V8", key: "1io7kd" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Copy = createLucideIcon("Copy", [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Cpu = createLucideIcon("Cpu", [
  ["rect", { width: "16", height: "16", x: "4", y: "4", rx: "2", key: "14l7u7" }],
  ["rect", { width: "6", height: "6", x: "9", y: "9", rx: "1", key: "5aljv4" }],
  ["path", { d: "M15 2v2", key: "13l42r" }],
  ["path", { d: "M15 20v2", key: "15mkzm" }],
  ["path", { d: "M2 15h2", key: "1gxd5l" }],
  ["path", { d: "M2 9h2", key: "1bbxkp" }],
  ["path", { d: "M20 15h2", key: "19e6y8" }],
  ["path", { d: "M20 9h2", key: "19tzq7" }],
  ["path", { d: "M9 2v2", key: "165o2o" }],
  ["path", { d: "M9 20v2", key: "i2bqo8" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const ExternalLink = createLucideIcon("ExternalLink", [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const FileText = createLucideIcon("FileText", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M10 9H8", key: "b1mrlr" }],
  ["path", { d: "M16 13H8", key: "t4e002" }],
  ["path", { d: "M16 17H8", key: "z1uh3a" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const KeyRound = createLucideIcon("KeyRound", [
  [
    "path",
    {
      d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
      key: "1s6t7t"
    }
  ],
  ["circle", { cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor", key: "w0ekpg" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Languages = createLucideIcon("Languages", [
  ["path", { d: "m5 8 6 6", key: "1wu5hv" }],
  ["path", { d: "m4 14 6-6 2-3", key: "1k1g8d" }],
  ["path", { d: "M2 5h12", key: "or177f" }],
  ["path", { d: "M7 2h1", key: "1t2jsx" }],
  ["path", { d: "m22 22-5-10-5 10", key: "don7ne" }],
  ["path", { d: "M14 18h6", key: "1m8k6r" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const LayoutDashboard = createLucideIcon("LayoutDashboard", [
  ["rect", { width: "7", height: "9", x: "3", y: "3", rx: "1", key: "10lvy0" }],
  ["rect", { width: "7", height: "5", x: "14", y: "3", rx: "1", key: "16une8" }],
  ["rect", { width: "7", height: "9", x: "14", y: "12", rx: "1", key: "1hutg5" }],
  ["rect", { width: "7", height: "5", x: "3", y: "16", rx: "1", key: "ldoo1y" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Moon = createLucideIcon("Moon", [
  ["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z", key: "a7tn18" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Network = createLucideIcon("Network", [
  ["rect", { x: "16", y: "16", width: "6", height: "6", rx: "1", key: "4q2zg0" }],
  ["rect", { x: "2", y: "16", width: "6", height: "6", rx: "1", key: "8cvhb9" }],
  ["rect", { x: "9", y: "2", width: "6", height: "6", rx: "1", key: "1egb70" }],
  ["path", { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", key: "1jsf9p" }],
  ["path", { d: "M12 12V8", key: "2874zd" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const PanelLeftClose = createLucideIcon("PanelLeftClose", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }],
  ["path", { d: "m16 15-3-3 3-3", key: "14y99z" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const PanelLeftOpen = createLucideIcon("PanelLeftOpen", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }],
  ["path", { d: "m14 9 3 3-3 3", key: "8010ee" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Pause = createLucideIcon("Pause", [
  ["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1", key: "zuxfzm" }],
  ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1", key: "1okwgv" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Power = createLucideIcon("Power", [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const RotateCw = createLucideIcon("RotateCw", [
  ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", key: "1p45f6" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Server = createLucideIcon("Server", [
  ["rect", { width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2", key: "ngkwjq" }],
  ["rect", { width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2", key: "iecqi9" }],
  ["line", { x1: "6", x2: "6.01", y1: "6", y2: "6", key: "16zg32" }],
  ["line", { x1: "6", x2: "6.01", y1: "18", y2: "18", key: "nzw8ys" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Settings2 = createLucideIcon("Settings2", [
  ["path", { d: "M20 7h-9", key: "3s1dr2" }],
  ["path", { d: "M14 17H5", key: "gfn3mx" }],
  ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }],
  ["circle", { cx: "7", cy: "7", r: "3", key: "dfmy0x" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Settings$1 = createLucideIcon("Settings", [
  [
    "path",
    {
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      key: "1qme2f"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Square = createLucideIcon("Square", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Sun = createLucideIcon("Sun", [
  ["circle", { cx: "12", cy: "12", r: "4", key: "4exip2" }],
  ["path", { d: "M12 2v2", key: "tus03m" }],
  ["path", { d: "M12 20v2", key: "1lh1kg" }],
  ["path", { d: "m4.93 4.93 1.41 1.41", key: "149t6j" }],
  ["path", { d: "m17.66 17.66 1.41 1.41", key: "ptbguv" }],
  ["path", { d: "M2 12h2", key: "1t8f8n" }],
  ["path", { d: "M20 12h2", key: "1q8mjw" }],
  ["path", { d: "m6.34 17.66-1.41 1.41", key: "1m8zz5" }],
  ["path", { d: "m19.07 4.93-1.41 1.41", key: "1shlcs" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const TriangleAlert = createLucideIcon("TriangleAlert", [
  [
    "path",
    {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      key: "wmoenq"
    }
  ],
  ["path", { d: "M12 9v4", key: "juzpu7" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const WifiOff = createLucideIcon("WifiOff", [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 5.17-2.69", key: "1dl1wf" }],
  ["path", { d: "M19 12.859a10 10 0 0 0-2.007-1.523", key: "4k23kn" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 4.177-2.643", key: "1grhjp" }],
  ["path", { d: "M22 8.82a15 15 0 0 0-11.288-3.764", key: "z3jwby" }],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Wifi = createLucideIcon("Wifi", [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 20 0", key: "dnpr2z" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 14 0", key: "1x1e6c" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Zap = createLucideIcon("Zap", [
  [
    "path",
    {
      d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
      key: "1xq2db"
    }
  ]
]);
function r(e) {
  var t2, f2, n2 = "";
  if ("string" == typeof e || "number" == typeof e) n2 += e;
  else if ("object" == typeof e) if (Array.isArray(e)) {
    var o = e.length;
    for (t2 = 0; t2 < o; t2++) e[t2] && (f2 = r(e[t2])) && (n2 && (n2 += " "), n2 += f2);
  } else for (f2 in e) e[f2] && (n2 && (n2 += " "), n2 += f2);
  return n2;
}
function clsx() {
  for (var e, t2, f2 = 0, n2 = "", o = arguments.length; f2 < o; f2++) (e = arguments[f2]) && (t2 = r(e)) && (n2 && (n2 += " "), n2 += t2);
  return n2;
}
const CLASS_PART_SEPARATOR = "-";
const createClassGroupUtils = (config) => {
  const classMap = createClassMap(config);
  const {
    conflictingClassGroups,
    conflictingClassGroupModifiers
  } = config;
  const getClassGroupId = (className) => {
    const classParts = className.split(CLASS_PART_SEPARATOR);
    if (classParts[0] === "" && classParts.length !== 1) {
      classParts.shift();
    }
    return getGroupRecursive(classParts, classMap) || getGroupIdForArbitraryProperty(className);
  };
  const getConflictingClassGroupIds = (classGroupId, hasPostfixModifier) => {
    const conflicts = conflictingClassGroups[classGroupId] || [];
    if (hasPostfixModifier && conflictingClassGroupModifiers[classGroupId]) {
      return [...conflicts, ...conflictingClassGroupModifiers[classGroupId]];
    }
    return conflicts;
  };
  return {
    getClassGroupId,
    getConflictingClassGroupIds
  };
};
const getGroupRecursive = (classParts, classPartObject) => {
  if (classParts.length === 0) {
    return classPartObject.classGroupId;
  }
  const currentClassPart = classParts[0];
  const nextClassPartObject = classPartObject.nextPart.get(currentClassPart);
  const classGroupFromNextClassPart = nextClassPartObject ? getGroupRecursive(classParts.slice(1), nextClassPartObject) : void 0;
  if (classGroupFromNextClassPart) {
    return classGroupFromNextClassPart;
  }
  if (classPartObject.validators.length === 0) {
    return void 0;
  }
  const classRest = classParts.join(CLASS_PART_SEPARATOR);
  return classPartObject.validators.find(({
    validator
  }) => validator(classRest))?.classGroupId;
};
const arbitraryPropertyRegex = /^\[(.+)\]$/;
const getGroupIdForArbitraryProperty = (className) => {
  if (arbitraryPropertyRegex.test(className)) {
    const arbitraryPropertyClassName = arbitraryPropertyRegex.exec(className)[1];
    const property = arbitraryPropertyClassName?.substring(0, arbitraryPropertyClassName.indexOf(":"));
    if (property) {
      return "arbitrary.." + property;
    }
  }
};
const createClassMap = (config) => {
  const {
    theme,
    prefix
  } = config;
  const classMap = {
    nextPart: /* @__PURE__ */ new Map(),
    validators: []
  };
  const prefixedClassGroupEntries = getPrefixedClassGroupEntries(Object.entries(config.classGroups), prefix);
  prefixedClassGroupEntries.forEach(([classGroupId, classGroup]) => {
    processClassesRecursively(classGroup, classMap, classGroupId, theme);
  });
  return classMap;
};
const processClassesRecursively = (classGroup, classPartObject, classGroupId, theme) => {
  classGroup.forEach((classDefinition) => {
    if (typeof classDefinition === "string") {
      const classPartObjectToEdit = classDefinition === "" ? classPartObject : getPart(classPartObject, classDefinition);
      classPartObjectToEdit.classGroupId = classGroupId;
      return;
    }
    if (typeof classDefinition === "function") {
      if (isThemeGetter(classDefinition)) {
        processClassesRecursively(classDefinition(theme), classPartObject, classGroupId, theme);
        return;
      }
      classPartObject.validators.push({
        validator: classDefinition,
        classGroupId
      });
      return;
    }
    Object.entries(classDefinition).forEach(([key, classGroup2]) => {
      processClassesRecursively(classGroup2, getPart(classPartObject, key), classGroupId, theme);
    });
  });
};
const getPart = (classPartObject, path2) => {
  let currentClassPartObject = classPartObject;
  path2.split(CLASS_PART_SEPARATOR).forEach((pathPart) => {
    if (!currentClassPartObject.nextPart.has(pathPart)) {
      currentClassPartObject.nextPart.set(pathPart, {
        nextPart: /* @__PURE__ */ new Map(),
        validators: []
      });
    }
    currentClassPartObject = currentClassPartObject.nextPart.get(pathPart);
  });
  return currentClassPartObject;
};
const isThemeGetter = (func) => func.isThemeGetter;
const getPrefixedClassGroupEntries = (classGroupEntries, prefix) => {
  if (!prefix) {
    return classGroupEntries;
  }
  return classGroupEntries.map(([classGroupId, classGroup]) => {
    const prefixedClassGroup = classGroup.map((classDefinition) => {
      if (typeof classDefinition === "string") {
        return prefix + classDefinition;
      }
      if (typeof classDefinition === "object") {
        return Object.fromEntries(Object.entries(classDefinition).map(([key, value]) => [prefix + key, value]));
      }
      return classDefinition;
    });
    return [classGroupId, prefixedClassGroup];
  });
};
const createLruCache = (maxCacheSize) => {
  if (maxCacheSize < 1) {
    return {
      get: () => void 0,
      set: () => {
      }
    };
  }
  let cacheSize = 0;
  let cache = /* @__PURE__ */ new Map();
  let previousCache = /* @__PURE__ */ new Map();
  const update = (key, value) => {
    cache.set(key, value);
    cacheSize++;
    if (cacheSize > maxCacheSize) {
      cacheSize = 0;
      previousCache = cache;
      cache = /* @__PURE__ */ new Map();
    }
  };
  return {
    get(key) {
      let value = cache.get(key);
      if (value !== void 0) {
        return value;
      }
      if ((value = previousCache.get(key)) !== void 0) {
        update(key, value);
        return value;
      }
    },
    set(key, value) {
      if (cache.has(key)) {
        cache.set(key, value);
      } else {
        update(key, value);
      }
    }
  };
};
const IMPORTANT_MODIFIER = "!";
const createParseClassName = (config) => {
  const {
    separator,
    experimentalParseClassName
  } = config;
  const isSeparatorSingleCharacter = separator.length === 1;
  const firstSeparatorCharacter = separator[0];
  const separatorLength = separator.length;
  const parseClassName = (className) => {
    const modifiers = [];
    let bracketDepth = 0;
    let modifierStart = 0;
    let postfixModifierPosition;
    for (let index = 0; index < className.length; index++) {
      let currentCharacter = className[index];
      if (bracketDepth === 0) {
        if (currentCharacter === firstSeparatorCharacter && (isSeparatorSingleCharacter || className.slice(index, index + separatorLength) === separator)) {
          modifiers.push(className.slice(modifierStart, index));
          modifierStart = index + separatorLength;
          continue;
        }
        if (currentCharacter === "/") {
          postfixModifierPosition = index;
          continue;
        }
      }
      if (currentCharacter === "[") {
        bracketDepth++;
      } else if (currentCharacter === "]") {
        bracketDepth--;
      }
    }
    const baseClassNameWithImportantModifier = modifiers.length === 0 ? className : className.substring(modifierStart);
    const hasImportantModifier = baseClassNameWithImportantModifier.startsWith(IMPORTANT_MODIFIER);
    const baseClassName = hasImportantModifier ? baseClassNameWithImportantModifier.substring(1) : baseClassNameWithImportantModifier;
    const maybePostfixModifierPosition = postfixModifierPosition && postfixModifierPosition > modifierStart ? postfixModifierPosition - modifierStart : void 0;
    return {
      modifiers,
      hasImportantModifier,
      baseClassName,
      maybePostfixModifierPosition
    };
  };
  if (experimentalParseClassName) {
    return (className) => experimentalParseClassName({
      className,
      parseClassName
    });
  }
  return parseClassName;
};
const sortModifiers = (modifiers) => {
  if (modifiers.length <= 1) {
    return modifiers;
  }
  const sortedModifiers = [];
  let unsortedModifiers = [];
  modifiers.forEach((modifier) => {
    const isArbitraryVariant = modifier[0] === "[";
    if (isArbitraryVariant) {
      sortedModifiers.push(...unsortedModifiers.sort(), modifier);
      unsortedModifiers = [];
    } else {
      unsortedModifiers.push(modifier);
    }
  });
  sortedModifiers.push(...unsortedModifiers.sort());
  return sortedModifiers;
};
const createConfigUtils = (config) => ({
  cache: createLruCache(config.cacheSize),
  parseClassName: createParseClassName(config),
  ...createClassGroupUtils(config)
});
const SPLIT_CLASSES_REGEX = /\s+/;
const mergeClassList = (classList, configUtils) => {
  const {
    parseClassName,
    getClassGroupId,
    getConflictingClassGroupIds
  } = configUtils;
  const classGroupsInConflict = [];
  const classNames = classList.trim().split(SPLIT_CLASSES_REGEX);
  let result = "";
  for (let index = classNames.length - 1; index >= 0; index -= 1) {
    const originalClassName = classNames[index];
    const {
      modifiers,
      hasImportantModifier,
      baseClassName,
      maybePostfixModifierPosition
    } = parseClassName(originalClassName);
    let hasPostfixModifier = Boolean(maybePostfixModifierPosition);
    let classGroupId = getClassGroupId(hasPostfixModifier ? baseClassName.substring(0, maybePostfixModifierPosition) : baseClassName);
    if (!classGroupId) {
      if (!hasPostfixModifier) {
        result = originalClassName + (result.length > 0 ? " " + result : result);
        continue;
      }
      classGroupId = getClassGroupId(baseClassName);
      if (!classGroupId) {
        result = originalClassName + (result.length > 0 ? " " + result : result);
        continue;
      }
      hasPostfixModifier = false;
    }
    const variantModifier = sortModifiers(modifiers).join(":");
    const modifierId = hasImportantModifier ? variantModifier + IMPORTANT_MODIFIER : variantModifier;
    const classId = modifierId + classGroupId;
    if (classGroupsInConflict.includes(classId)) {
      continue;
    }
    classGroupsInConflict.push(classId);
    const conflictGroups = getConflictingClassGroupIds(classGroupId, hasPostfixModifier);
    for (let i = 0; i < conflictGroups.length; ++i) {
      const group = conflictGroups[i];
      classGroupsInConflict.push(modifierId + group);
    }
    result = originalClassName + (result.length > 0 ? " " + result : result);
  }
  return result;
};
function twJoin() {
  let index = 0;
  let argument;
  let resolvedValue;
  let string = "";
  while (index < arguments.length) {
    if (argument = arguments[index++]) {
      if (resolvedValue = toValue(argument)) {
        string && (string += " ");
        string += resolvedValue;
      }
    }
  }
  return string;
}
const toValue = (mix) => {
  if (typeof mix === "string") {
    return mix;
  }
  let resolvedValue;
  let string = "";
  for (let k2 = 0; k2 < mix.length; k2++) {
    if (mix[k2]) {
      if (resolvedValue = toValue(mix[k2])) {
        string && (string += " ");
        string += resolvedValue;
      }
    }
  }
  return string;
};
function createTailwindMerge(createConfigFirst, ...createConfigRest) {
  let configUtils;
  let cacheGet;
  let cacheSet;
  let functionToCall = initTailwindMerge;
  function initTailwindMerge(classList) {
    const config = createConfigRest.reduce((previousConfig, createConfigCurrent) => createConfigCurrent(previousConfig), createConfigFirst());
    configUtils = createConfigUtils(config);
    cacheGet = configUtils.cache.get;
    cacheSet = configUtils.cache.set;
    functionToCall = tailwindMerge;
    return tailwindMerge(classList);
  }
  function tailwindMerge(classList) {
    const cachedResult = cacheGet(classList);
    if (cachedResult) {
      return cachedResult;
    }
    const result = mergeClassList(classList, configUtils);
    cacheSet(classList, result);
    return result;
  }
  return function callTailwindMerge() {
    return functionToCall(twJoin.apply(null, arguments));
  };
}
const fromTheme = (key) => {
  const themeGetter = (theme) => theme[key] || [];
  themeGetter.isThemeGetter = true;
  return themeGetter;
};
const arbitraryValueRegex = /^\[(?:([a-z-]+):)?(.+)\]$/i;
const fractionRegex = /^\d+\/\d+$/;
const stringLengths = /* @__PURE__ */ new Set(["px", "full", "screen"]);
const tshirtUnitRegex = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/;
const lengthUnitRegex = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/;
const colorFunctionRegex = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/;
const shadowRegex = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/;
const imageRegex = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/;
const isLength = (value) => isNumber(value) || stringLengths.has(value) || fractionRegex.test(value);
const isArbitraryLength = (value) => getIsArbitraryValue(value, "length", isLengthOnly);
const isNumber = (value) => Boolean(value) && !Number.isNaN(Number(value));
const isArbitraryNumber = (value) => getIsArbitraryValue(value, "number", isNumber);
const isInteger = (value) => Boolean(value) && Number.isInteger(Number(value));
const isPercent = (value) => value.endsWith("%") && isNumber(value.slice(0, -1));
const isArbitraryValue = (value) => arbitraryValueRegex.test(value);
const isTshirtSize = (value) => tshirtUnitRegex.test(value);
const sizeLabels = /* @__PURE__ */ new Set(["length", "size", "percentage"]);
const isArbitrarySize = (value) => getIsArbitraryValue(value, sizeLabels, isNever);
const isArbitraryPosition = (value) => getIsArbitraryValue(value, "position", isNever);
const imageLabels = /* @__PURE__ */ new Set(["image", "url"]);
const isArbitraryImage = (value) => getIsArbitraryValue(value, imageLabels, isImage);
const isArbitraryShadow = (value) => getIsArbitraryValue(value, "", isShadow);
const isAny = () => true;
const getIsArbitraryValue = (value, label, testValue) => {
  const result = arbitraryValueRegex.exec(value);
  if (result) {
    if (result[1]) {
      return typeof label === "string" ? result[1] === label : label.has(result[1]);
    }
    return testValue(result[2]);
  }
  return false;
};
const isLengthOnly = (value) => (
  // `colorFunctionRegex` check is necessary because color functions can have percentages in them which which would be incorrectly classified as lengths.
  // For example, `hsl(0 0% 0%)` would be classified as a length without this check.
  // I could also use lookbehind assertion in `lengthUnitRegex` but that isn't supported widely enough.
  lengthUnitRegex.test(value) && !colorFunctionRegex.test(value)
);
const isNever = () => false;
const isShadow = (value) => shadowRegex.test(value);
const isImage = (value) => imageRegex.test(value);
const getDefaultConfig = () => {
  const colors = fromTheme("colors");
  const spacing = fromTheme("spacing");
  const blur = fromTheme("blur");
  const brightness = fromTheme("brightness");
  const borderColor = fromTheme("borderColor");
  const borderRadius = fromTheme("borderRadius");
  const borderSpacing = fromTheme("borderSpacing");
  const borderWidth = fromTheme("borderWidth");
  const contrast = fromTheme("contrast");
  const grayscale = fromTheme("grayscale");
  const hueRotate = fromTheme("hueRotate");
  const invert = fromTheme("invert");
  const gap = fromTheme("gap");
  const gradientColorStops = fromTheme("gradientColorStops");
  const gradientColorStopPositions = fromTheme("gradientColorStopPositions");
  const inset = fromTheme("inset");
  const margin = fromTheme("margin");
  const opacity = fromTheme("opacity");
  const padding = fromTheme("padding");
  const saturate = fromTheme("saturate");
  const scale = fromTheme("scale");
  const sepia = fromTheme("sepia");
  const skew = fromTheme("skew");
  const space = fromTheme("space");
  const translate = fromTheme("translate");
  const getOverscroll = () => ["auto", "contain", "none"];
  const getOverflow = () => ["auto", "hidden", "clip", "visible", "scroll"];
  const getSpacingWithAutoAndArbitrary = () => ["auto", isArbitraryValue, spacing];
  const getSpacingWithArbitrary = () => [isArbitraryValue, spacing];
  const getLengthWithEmptyAndArbitrary = () => ["", isLength, isArbitraryLength];
  const getNumberWithAutoAndArbitrary = () => ["auto", isNumber, isArbitraryValue];
  const getPositions = () => ["bottom", "center", "left", "left-bottom", "left-top", "right", "right-bottom", "right-top", "top"];
  const getLineStyles = () => ["solid", "dashed", "dotted", "double", "none"];
  const getBlendModes = () => ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
  const getAlign = () => ["start", "end", "center", "between", "around", "evenly", "stretch"];
  const getZeroAndEmpty = () => ["", "0", isArbitraryValue];
  const getBreaks = () => ["auto", "avoid", "all", "avoid-page", "page", "left", "right", "column"];
  const getNumberAndArbitrary = () => [isNumber, isArbitraryValue];
  return {
    cacheSize: 500,
    separator: ":",
    theme: {
      colors: [isAny],
      spacing: [isLength, isArbitraryLength],
      blur: ["none", "", isTshirtSize, isArbitraryValue],
      brightness: getNumberAndArbitrary(),
      borderColor: [colors],
      borderRadius: ["none", "", "full", isTshirtSize, isArbitraryValue],
      borderSpacing: getSpacingWithArbitrary(),
      borderWidth: getLengthWithEmptyAndArbitrary(),
      contrast: getNumberAndArbitrary(),
      grayscale: getZeroAndEmpty(),
      hueRotate: getNumberAndArbitrary(),
      invert: getZeroAndEmpty(),
      gap: getSpacingWithArbitrary(),
      gradientColorStops: [colors],
      gradientColorStopPositions: [isPercent, isArbitraryLength],
      inset: getSpacingWithAutoAndArbitrary(),
      margin: getSpacingWithAutoAndArbitrary(),
      opacity: getNumberAndArbitrary(),
      padding: getSpacingWithArbitrary(),
      saturate: getNumberAndArbitrary(),
      scale: getNumberAndArbitrary(),
      sepia: getZeroAndEmpty(),
      skew: getNumberAndArbitrary(),
      space: getSpacingWithArbitrary(),
      translate: getSpacingWithArbitrary()
    },
    classGroups: {
      // Layout
      /**
       * Aspect Ratio
       * @see https://tailwindcss.com/docs/aspect-ratio
       */
      aspect: [{
        aspect: ["auto", "square", "video", isArbitraryValue]
      }],
      /**
       * Container
       * @see https://tailwindcss.com/docs/container
       */
      container: ["container"],
      /**
       * Columns
       * @see https://tailwindcss.com/docs/columns
       */
      columns: [{
        columns: [isTshirtSize]
      }],
      /**
       * Break After
       * @see https://tailwindcss.com/docs/break-after
       */
      "break-after": [{
        "break-after": getBreaks()
      }],
      /**
       * Break Before
       * @see https://tailwindcss.com/docs/break-before
       */
      "break-before": [{
        "break-before": getBreaks()
      }],
      /**
       * Break Inside
       * @see https://tailwindcss.com/docs/break-inside
       */
      "break-inside": [{
        "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"]
      }],
      /**
       * Box Decoration Break
       * @see https://tailwindcss.com/docs/box-decoration-break
       */
      "box-decoration": [{
        "box-decoration": ["slice", "clone"]
      }],
      /**
       * Box Sizing
       * @see https://tailwindcss.com/docs/box-sizing
       */
      box: [{
        box: ["border", "content"]
      }],
      /**
       * Display
       * @see https://tailwindcss.com/docs/display
       */
      display: ["block", "inline-block", "inline", "flex", "inline-flex", "table", "inline-table", "table-caption", "table-cell", "table-column", "table-column-group", "table-footer-group", "table-header-group", "table-row-group", "table-row", "flow-root", "grid", "inline-grid", "contents", "list-item", "hidden"],
      /**
       * Floats
       * @see https://tailwindcss.com/docs/float
       */
      float: [{
        float: ["right", "left", "none", "start", "end"]
      }],
      /**
       * Clear
       * @see https://tailwindcss.com/docs/clear
       */
      clear: [{
        clear: ["left", "right", "both", "none", "start", "end"]
      }],
      /**
       * Isolation
       * @see https://tailwindcss.com/docs/isolation
       */
      isolation: ["isolate", "isolation-auto"],
      /**
       * Object Fit
       * @see https://tailwindcss.com/docs/object-fit
       */
      "object-fit": [{
        object: ["contain", "cover", "fill", "none", "scale-down"]
      }],
      /**
       * Object Position
       * @see https://tailwindcss.com/docs/object-position
       */
      "object-position": [{
        object: [...getPositions(), isArbitraryValue]
      }],
      /**
       * Overflow
       * @see https://tailwindcss.com/docs/overflow
       */
      overflow: [{
        overflow: getOverflow()
      }],
      /**
       * Overflow X
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-x": [{
        "overflow-x": getOverflow()
      }],
      /**
       * Overflow Y
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-y": [{
        "overflow-y": getOverflow()
      }],
      /**
       * Overscroll Behavior
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      overscroll: [{
        overscroll: getOverscroll()
      }],
      /**
       * Overscroll Behavior X
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-x": [{
        "overscroll-x": getOverscroll()
      }],
      /**
       * Overscroll Behavior Y
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-y": [{
        "overscroll-y": getOverscroll()
      }],
      /**
       * Position
       * @see https://tailwindcss.com/docs/position
       */
      position: ["static", "fixed", "absolute", "relative", "sticky"],
      /**
       * Top / Right / Bottom / Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      inset: [{
        inset: [inset]
      }],
      /**
       * Right / Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-x": [{
        "inset-x": [inset]
      }],
      /**
       * Top / Bottom
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-y": [{
        "inset-y": [inset]
      }],
      /**
       * Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      start: [{
        start: [inset]
      }],
      /**
       * End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      end: [{
        end: [inset]
      }],
      /**
       * Top
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      top: [{
        top: [inset]
      }],
      /**
       * Right
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      right: [{
        right: [inset]
      }],
      /**
       * Bottom
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      bottom: [{
        bottom: [inset]
      }],
      /**
       * Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      left: [{
        left: [inset]
      }],
      /**
       * Visibility
       * @see https://tailwindcss.com/docs/visibility
       */
      visibility: ["visible", "invisible", "collapse"],
      /**
       * Z-Index
       * @see https://tailwindcss.com/docs/z-index
       */
      z: [{
        z: ["auto", isInteger, isArbitraryValue]
      }],
      // Flexbox and Grid
      /**
       * Flex Basis
       * @see https://tailwindcss.com/docs/flex-basis
       */
      basis: [{
        basis: getSpacingWithAutoAndArbitrary()
      }],
      /**
       * Flex Direction
       * @see https://tailwindcss.com/docs/flex-direction
       */
      "flex-direction": [{
        flex: ["row", "row-reverse", "col", "col-reverse"]
      }],
      /**
       * Flex Wrap
       * @see https://tailwindcss.com/docs/flex-wrap
       */
      "flex-wrap": [{
        flex: ["wrap", "wrap-reverse", "nowrap"]
      }],
      /**
       * Flex
       * @see https://tailwindcss.com/docs/flex
       */
      flex: [{
        flex: ["1", "auto", "initial", "none", isArbitraryValue]
      }],
      /**
       * Flex Grow
       * @see https://tailwindcss.com/docs/flex-grow
       */
      grow: [{
        grow: getZeroAndEmpty()
      }],
      /**
       * Flex Shrink
       * @see https://tailwindcss.com/docs/flex-shrink
       */
      shrink: [{
        shrink: getZeroAndEmpty()
      }],
      /**
       * Order
       * @see https://tailwindcss.com/docs/order
       */
      order: [{
        order: ["first", "last", "none", isInteger, isArbitraryValue]
      }],
      /**
       * Grid Template Columns
       * @see https://tailwindcss.com/docs/grid-template-columns
       */
      "grid-cols": [{
        "grid-cols": [isAny]
      }],
      /**
       * Grid Column Start / End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start-end": [{
        col: ["auto", {
          span: ["full", isInteger, isArbitraryValue]
        }, isArbitraryValue]
      }],
      /**
       * Grid Column Start
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start": [{
        "col-start": getNumberWithAutoAndArbitrary()
      }],
      /**
       * Grid Column End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-end": [{
        "col-end": getNumberWithAutoAndArbitrary()
      }],
      /**
       * Grid Template Rows
       * @see https://tailwindcss.com/docs/grid-template-rows
       */
      "grid-rows": [{
        "grid-rows": [isAny]
      }],
      /**
       * Grid Row Start / End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start-end": [{
        row: ["auto", {
          span: [isInteger, isArbitraryValue]
        }, isArbitraryValue]
      }],
      /**
       * Grid Row Start
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start": [{
        "row-start": getNumberWithAutoAndArbitrary()
      }],
      /**
       * Grid Row End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-end": [{
        "row-end": getNumberWithAutoAndArbitrary()
      }],
      /**
       * Grid Auto Flow
       * @see https://tailwindcss.com/docs/grid-auto-flow
       */
      "grid-flow": [{
        "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"]
      }],
      /**
       * Grid Auto Columns
       * @see https://tailwindcss.com/docs/grid-auto-columns
       */
      "auto-cols": [{
        "auto-cols": ["auto", "min", "max", "fr", isArbitraryValue]
      }],
      /**
       * Grid Auto Rows
       * @see https://tailwindcss.com/docs/grid-auto-rows
       */
      "auto-rows": [{
        "auto-rows": ["auto", "min", "max", "fr", isArbitraryValue]
      }],
      /**
       * Gap
       * @see https://tailwindcss.com/docs/gap
       */
      gap: [{
        gap: [gap]
      }],
      /**
       * Gap X
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-x": [{
        "gap-x": [gap]
      }],
      /**
       * Gap Y
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-y": [{
        "gap-y": [gap]
      }],
      /**
       * Justify Content
       * @see https://tailwindcss.com/docs/justify-content
       */
      "justify-content": [{
        justify: ["normal", ...getAlign()]
      }],
      /**
       * Justify Items
       * @see https://tailwindcss.com/docs/justify-items
       */
      "justify-items": [{
        "justify-items": ["start", "end", "center", "stretch"]
      }],
      /**
       * Justify Self
       * @see https://tailwindcss.com/docs/justify-self
       */
      "justify-self": [{
        "justify-self": ["auto", "start", "end", "center", "stretch"]
      }],
      /**
       * Align Content
       * @see https://tailwindcss.com/docs/align-content
       */
      "align-content": [{
        content: ["normal", ...getAlign(), "baseline"]
      }],
      /**
       * Align Items
       * @see https://tailwindcss.com/docs/align-items
       */
      "align-items": [{
        items: ["start", "end", "center", "baseline", "stretch"]
      }],
      /**
       * Align Self
       * @see https://tailwindcss.com/docs/align-self
       */
      "align-self": [{
        self: ["auto", "start", "end", "center", "stretch", "baseline"]
      }],
      /**
       * Place Content
       * @see https://tailwindcss.com/docs/place-content
       */
      "place-content": [{
        "place-content": [...getAlign(), "baseline"]
      }],
      /**
       * Place Items
       * @see https://tailwindcss.com/docs/place-items
       */
      "place-items": [{
        "place-items": ["start", "end", "center", "baseline", "stretch"]
      }],
      /**
       * Place Self
       * @see https://tailwindcss.com/docs/place-self
       */
      "place-self": [{
        "place-self": ["auto", "start", "end", "center", "stretch"]
      }],
      // Spacing
      /**
       * Padding
       * @see https://tailwindcss.com/docs/padding
       */
      p: [{
        p: [padding]
      }],
      /**
       * Padding X
       * @see https://tailwindcss.com/docs/padding
       */
      px: [{
        px: [padding]
      }],
      /**
       * Padding Y
       * @see https://tailwindcss.com/docs/padding
       */
      py: [{
        py: [padding]
      }],
      /**
       * Padding Start
       * @see https://tailwindcss.com/docs/padding
       */
      ps: [{
        ps: [padding]
      }],
      /**
       * Padding End
       * @see https://tailwindcss.com/docs/padding
       */
      pe: [{
        pe: [padding]
      }],
      /**
       * Padding Top
       * @see https://tailwindcss.com/docs/padding
       */
      pt: [{
        pt: [padding]
      }],
      /**
       * Padding Right
       * @see https://tailwindcss.com/docs/padding
       */
      pr: [{
        pr: [padding]
      }],
      /**
       * Padding Bottom
       * @see https://tailwindcss.com/docs/padding
       */
      pb: [{
        pb: [padding]
      }],
      /**
       * Padding Left
       * @see https://tailwindcss.com/docs/padding
       */
      pl: [{
        pl: [padding]
      }],
      /**
       * Margin
       * @see https://tailwindcss.com/docs/margin
       */
      m: [{
        m: [margin]
      }],
      /**
       * Margin X
       * @see https://tailwindcss.com/docs/margin
       */
      mx: [{
        mx: [margin]
      }],
      /**
       * Margin Y
       * @see https://tailwindcss.com/docs/margin
       */
      my: [{
        my: [margin]
      }],
      /**
       * Margin Start
       * @see https://tailwindcss.com/docs/margin
       */
      ms: [{
        ms: [margin]
      }],
      /**
       * Margin End
       * @see https://tailwindcss.com/docs/margin
       */
      me: [{
        me: [margin]
      }],
      /**
       * Margin Top
       * @see https://tailwindcss.com/docs/margin
       */
      mt: [{
        mt: [margin]
      }],
      /**
       * Margin Right
       * @see https://tailwindcss.com/docs/margin
       */
      mr: [{
        mr: [margin]
      }],
      /**
       * Margin Bottom
       * @see https://tailwindcss.com/docs/margin
       */
      mb: [{
        mb: [margin]
      }],
      /**
       * Margin Left
       * @see https://tailwindcss.com/docs/margin
       */
      ml: [{
        ml: [margin]
      }],
      /**
       * Space Between X
       * @see https://tailwindcss.com/docs/space
       */
      "space-x": [{
        "space-x": [space]
      }],
      /**
       * Space Between X Reverse
       * @see https://tailwindcss.com/docs/space
       */
      "space-x-reverse": ["space-x-reverse"],
      /**
       * Space Between Y
       * @see https://tailwindcss.com/docs/space
       */
      "space-y": [{
        "space-y": [space]
      }],
      /**
       * Space Between Y Reverse
       * @see https://tailwindcss.com/docs/space
       */
      "space-y-reverse": ["space-y-reverse"],
      // Sizing
      /**
       * Width
       * @see https://tailwindcss.com/docs/width
       */
      w: [{
        w: ["auto", "min", "max", "fit", "svw", "lvw", "dvw", isArbitraryValue, spacing]
      }],
      /**
       * Min-Width
       * @see https://tailwindcss.com/docs/min-width
       */
      "min-w": [{
        "min-w": [isArbitraryValue, spacing, "min", "max", "fit"]
      }],
      /**
       * Max-Width
       * @see https://tailwindcss.com/docs/max-width
       */
      "max-w": [{
        "max-w": [isArbitraryValue, spacing, "none", "full", "min", "max", "fit", "prose", {
          screen: [isTshirtSize]
        }, isTshirtSize]
      }],
      /**
       * Height
       * @see https://tailwindcss.com/docs/height
       */
      h: [{
        h: [isArbitraryValue, spacing, "auto", "min", "max", "fit", "svh", "lvh", "dvh"]
      }],
      /**
       * Min-Height
       * @see https://tailwindcss.com/docs/min-height
       */
      "min-h": [{
        "min-h": [isArbitraryValue, spacing, "min", "max", "fit", "svh", "lvh", "dvh"]
      }],
      /**
       * Max-Height
       * @see https://tailwindcss.com/docs/max-height
       */
      "max-h": [{
        "max-h": [isArbitraryValue, spacing, "min", "max", "fit", "svh", "lvh", "dvh"]
      }],
      /**
       * Size
       * @see https://tailwindcss.com/docs/size
       */
      size: [{
        size: [isArbitraryValue, spacing, "auto", "min", "max", "fit"]
      }],
      // Typography
      /**
       * Font Size
       * @see https://tailwindcss.com/docs/font-size
       */
      "font-size": [{
        text: ["base", isTshirtSize, isArbitraryLength]
      }],
      /**
       * Font Smoothing
       * @see https://tailwindcss.com/docs/font-smoothing
       */
      "font-smoothing": ["antialiased", "subpixel-antialiased"],
      /**
       * Font Style
       * @see https://tailwindcss.com/docs/font-style
       */
      "font-style": ["italic", "not-italic"],
      /**
       * Font Weight
       * @see https://tailwindcss.com/docs/font-weight
       */
      "font-weight": [{
        font: ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black", isArbitraryNumber]
      }],
      /**
       * Font Family
       * @see https://tailwindcss.com/docs/font-family
       */
      "font-family": [{
        font: [isAny]
      }],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-normal": ["normal-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-ordinal": ["ordinal"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-slashed-zero": ["slashed-zero"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-figure": ["lining-nums", "oldstyle-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-spacing": ["proportional-nums", "tabular-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
      /**
       * Letter Spacing
       * @see https://tailwindcss.com/docs/letter-spacing
       */
      tracking: [{
        tracking: ["tighter", "tight", "normal", "wide", "wider", "widest", isArbitraryValue]
      }],
      /**
       * Line Clamp
       * @see https://tailwindcss.com/docs/line-clamp
       */
      "line-clamp": [{
        "line-clamp": ["none", isNumber, isArbitraryNumber]
      }],
      /**
       * Line Height
       * @see https://tailwindcss.com/docs/line-height
       */
      leading: [{
        leading: ["none", "tight", "snug", "normal", "relaxed", "loose", isLength, isArbitraryValue]
      }],
      /**
       * List Style Image
       * @see https://tailwindcss.com/docs/list-style-image
       */
      "list-image": [{
        "list-image": ["none", isArbitraryValue]
      }],
      /**
       * List Style Type
       * @see https://tailwindcss.com/docs/list-style-type
       */
      "list-style-type": [{
        list: ["none", "disc", "decimal", isArbitraryValue]
      }],
      /**
       * List Style Position
       * @see https://tailwindcss.com/docs/list-style-position
       */
      "list-style-position": [{
        list: ["inside", "outside"]
      }],
      /**
       * Placeholder Color
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/placeholder-color
       */
      "placeholder-color": [{
        placeholder: [colors]
      }],
      /**
       * Placeholder Opacity
       * @see https://tailwindcss.com/docs/placeholder-opacity
       */
      "placeholder-opacity": [{
        "placeholder-opacity": [opacity]
      }],
      /**
       * Text Alignment
       * @see https://tailwindcss.com/docs/text-align
       */
      "text-alignment": [{
        text: ["left", "center", "right", "justify", "start", "end"]
      }],
      /**
       * Text Color
       * @see https://tailwindcss.com/docs/text-color
       */
      "text-color": [{
        text: [colors]
      }],
      /**
       * Text Opacity
       * @see https://tailwindcss.com/docs/text-opacity
       */
      "text-opacity": [{
        "text-opacity": [opacity]
      }],
      /**
       * Text Decoration
       * @see https://tailwindcss.com/docs/text-decoration
       */
      "text-decoration": ["underline", "overline", "line-through", "no-underline"],
      /**
       * Text Decoration Style
       * @see https://tailwindcss.com/docs/text-decoration-style
       */
      "text-decoration-style": [{
        decoration: [...getLineStyles(), "wavy"]
      }],
      /**
       * Text Decoration Thickness
       * @see https://tailwindcss.com/docs/text-decoration-thickness
       */
      "text-decoration-thickness": [{
        decoration: ["auto", "from-font", isLength, isArbitraryLength]
      }],
      /**
       * Text Underline Offset
       * @see https://tailwindcss.com/docs/text-underline-offset
       */
      "underline-offset": [{
        "underline-offset": ["auto", isLength, isArbitraryValue]
      }],
      /**
       * Text Decoration Color
       * @see https://tailwindcss.com/docs/text-decoration-color
       */
      "text-decoration-color": [{
        decoration: [colors]
      }],
      /**
       * Text Transform
       * @see https://tailwindcss.com/docs/text-transform
       */
      "text-transform": ["uppercase", "lowercase", "capitalize", "normal-case"],
      /**
       * Text Overflow
       * @see https://tailwindcss.com/docs/text-overflow
       */
      "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
      /**
       * Text Wrap
       * @see https://tailwindcss.com/docs/text-wrap
       */
      "text-wrap": [{
        text: ["wrap", "nowrap", "balance", "pretty"]
      }],
      /**
       * Text Indent
       * @see https://tailwindcss.com/docs/text-indent
       */
      indent: [{
        indent: getSpacingWithArbitrary()
      }],
      /**
       * Vertical Alignment
       * @see https://tailwindcss.com/docs/vertical-align
       */
      "vertical-align": [{
        align: ["baseline", "top", "middle", "bottom", "text-top", "text-bottom", "sub", "super", isArbitraryValue]
      }],
      /**
       * Whitespace
       * @see https://tailwindcss.com/docs/whitespace
       */
      whitespace: [{
        whitespace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"]
      }],
      /**
       * Word Break
       * @see https://tailwindcss.com/docs/word-break
       */
      break: [{
        break: ["normal", "words", "all", "keep"]
      }],
      /**
       * Hyphens
       * @see https://tailwindcss.com/docs/hyphens
       */
      hyphens: [{
        hyphens: ["none", "manual", "auto"]
      }],
      /**
       * Content
       * @see https://tailwindcss.com/docs/content
       */
      content: [{
        content: ["none", isArbitraryValue]
      }],
      // Backgrounds
      /**
       * Background Attachment
       * @see https://tailwindcss.com/docs/background-attachment
       */
      "bg-attachment": [{
        bg: ["fixed", "local", "scroll"]
      }],
      /**
       * Background Clip
       * @see https://tailwindcss.com/docs/background-clip
       */
      "bg-clip": [{
        "bg-clip": ["border", "padding", "content", "text"]
      }],
      /**
       * Background Opacity
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/background-opacity
       */
      "bg-opacity": [{
        "bg-opacity": [opacity]
      }],
      /**
       * Background Origin
       * @see https://tailwindcss.com/docs/background-origin
       */
      "bg-origin": [{
        "bg-origin": ["border", "padding", "content"]
      }],
      /**
       * Background Position
       * @see https://tailwindcss.com/docs/background-position
       */
      "bg-position": [{
        bg: [...getPositions(), isArbitraryPosition]
      }],
      /**
       * Background Repeat
       * @see https://tailwindcss.com/docs/background-repeat
       */
      "bg-repeat": [{
        bg: ["no-repeat", {
          repeat: ["", "x", "y", "round", "space"]
        }]
      }],
      /**
       * Background Size
       * @see https://tailwindcss.com/docs/background-size
       */
      "bg-size": [{
        bg: ["auto", "cover", "contain", isArbitrarySize]
      }],
      /**
       * Background Image
       * @see https://tailwindcss.com/docs/background-image
       */
      "bg-image": [{
        bg: ["none", {
          "gradient-to": ["t", "tr", "r", "br", "b", "bl", "l", "tl"]
        }, isArbitraryImage]
      }],
      /**
       * Background Color
       * @see https://tailwindcss.com/docs/background-color
       */
      "bg-color": [{
        bg: [colors]
      }],
      /**
       * Gradient Color Stops From Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from-pos": [{
        from: [gradientColorStopPositions]
      }],
      /**
       * Gradient Color Stops Via Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via-pos": [{
        via: [gradientColorStopPositions]
      }],
      /**
       * Gradient Color Stops To Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to-pos": [{
        to: [gradientColorStopPositions]
      }],
      /**
       * Gradient Color Stops From
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from": [{
        from: [gradientColorStops]
      }],
      /**
       * Gradient Color Stops Via
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via": [{
        via: [gradientColorStops]
      }],
      /**
       * Gradient Color Stops To
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to": [{
        to: [gradientColorStops]
      }],
      // Borders
      /**
       * Border Radius
       * @see https://tailwindcss.com/docs/border-radius
       */
      rounded: [{
        rounded: [borderRadius]
      }],
      /**
       * Border Radius Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-s": [{
        "rounded-s": [borderRadius]
      }],
      /**
       * Border Radius End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-e": [{
        "rounded-e": [borderRadius]
      }],
      /**
       * Border Radius Top
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-t": [{
        "rounded-t": [borderRadius]
      }],
      /**
       * Border Radius Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-r": [{
        "rounded-r": [borderRadius]
      }],
      /**
       * Border Radius Bottom
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-b": [{
        "rounded-b": [borderRadius]
      }],
      /**
       * Border Radius Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-l": [{
        "rounded-l": [borderRadius]
      }],
      /**
       * Border Radius Start Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ss": [{
        "rounded-ss": [borderRadius]
      }],
      /**
       * Border Radius Start End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-se": [{
        "rounded-se": [borderRadius]
      }],
      /**
       * Border Radius End End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ee": [{
        "rounded-ee": [borderRadius]
      }],
      /**
       * Border Radius End Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-es": [{
        "rounded-es": [borderRadius]
      }],
      /**
       * Border Radius Top Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tl": [{
        "rounded-tl": [borderRadius]
      }],
      /**
       * Border Radius Top Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tr": [{
        "rounded-tr": [borderRadius]
      }],
      /**
       * Border Radius Bottom Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-br": [{
        "rounded-br": [borderRadius]
      }],
      /**
       * Border Radius Bottom Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-bl": [{
        "rounded-bl": [borderRadius]
      }],
      /**
       * Border Width
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w": [{
        border: [borderWidth]
      }],
      /**
       * Border Width X
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-x": [{
        "border-x": [borderWidth]
      }],
      /**
       * Border Width Y
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-y": [{
        "border-y": [borderWidth]
      }],
      /**
       * Border Width Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-s": [{
        "border-s": [borderWidth]
      }],
      /**
       * Border Width End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-e": [{
        "border-e": [borderWidth]
      }],
      /**
       * Border Width Top
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-t": [{
        "border-t": [borderWidth]
      }],
      /**
       * Border Width Right
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-r": [{
        "border-r": [borderWidth]
      }],
      /**
       * Border Width Bottom
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-b": [{
        "border-b": [borderWidth]
      }],
      /**
       * Border Width Left
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-l": [{
        "border-l": [borderWidth]
      }],
      /**
       * Border Opacity
       * @see https://tailwindcss.com/docs/border-opacity
       */
      "border-opacity": [{
        "border-opacity": [opacity]
      }],
      /**
       * Border Style
       * @see https://tailwindcss.com/docs/border-style
       */
      "border-style": [{
        border: [...getLineStyles(), "hidden"]
      }],
      /**
       * Divide Width X
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-x": [{
        "divide-x": [borderWidth]
      }],
      /**
       * Divide Width X Reverse
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-x-reverse": ["divide-x-reverse"],
      /**
       * Divide Width Y
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-y": [{
        "divide-y": [borderWidth]
      }],
      /**
       * Divide Width Y Reverse
       * @see https://tailwindcss.com/docs/divide-width
       */
      "divide-y-reverse": ["divide-y-reverse"],
      /**
       * Divide Opacity
       * @see https://tailwindcss.com/docs/divide-opacity
       */
      "divide-opacity": [{
        "divide-opacity": [opacity]
      }],
      /**
       * Divide Style
       * @see https://tailwindcss.com/docs/divide-style
       */
      "divide-style": [{
        divide: getLineStyles()
      }],
      /**
       * Border Color
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color": [{
        border: [borderColor]
      }],
      /**
       * Border Color X
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-x": [{
        "border-x": [borderColor]
      }],
      /**
       * Border Color Y
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-y": [{
        "border-y": [borderColor]
      }],
      /**
       * Border Color S
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-s": [{
        "border-s": [borderColor]
      }],
      /**
       * Border Color E
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-e": [{
        "border-e": [borderColor]
      }],
      /**
       * Border Color Top
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-t": [{
        "border-t": [borderColor]
      }],
      /**
       * Border Color Right
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-r": [{
        "border-r": [borderColor]
      }],
      /**
       * Border Color Bottom
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-b": [{
        "border-b": [borderColor]
      }],
      /**
       * Border Color Left
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-l": [{
        "border-l": [borderColor]
      }],
      /**
       * Divide Color
       * @see https://tailwindcss.com/docs/divide-color
       */
      "divide-color": [{
        divide: [borderColor]
      }],
      /**
       * Outline Style
       * @see https://tailwindcss.com/docs/outline-style
       */
      "outline-style": [{
        outline: ["", ...getLineStyles()]
      }],
      /**
       * Outline Offset
       * @see https://tailwindcss.com/docs/outline-offset
       */
      "outline-offset": [{
        "outline-offset": [isLength, isArbitraryValue]
      }],
      /**
       * Outline Width
       * @see https://tailwindcss.com/docs/outline-width
       */
      "outline-w": [{
        outline: [isLength, isArbitraryLength]
      }],
      /**
       * Outline Color
       * @see https://tailwindcss.com/docs/outline-color
       */
      "outline-color": [{
        outline: [colors]
      }],
      /**
       * Ring Width
       * @see https://tailwindcss.com/docs/ring-width
       */
      "ring-w": [{
        ring: getLengthWithEmptyAndArbitrary()
      }],
      /**
       * Ring Width Inset
       * @see https://tailwindcss.com/docs/ring-width
       */
      "ring-w-inset": ["ring-inset"],
      /**
       * Ring Color
       * @see https://tailwindcss.com/docs/ring-color
       */
      "ring-color": [{
        ring: [colors]
      }],
      /**
       * Ring Opacity
       * @see https://tailwindcss.com/docs/ring-opacity
       */
      "ring-opacity": [{
        "ring-opacity": [opacity]
      }],
      /**
       * Ring Offset Width
       * @see https://tailwindcss.com/docs/ring-offset-width
       */
      "ring-offset-w": [{
        "ring-offset": [isLength, isArbitraryLength]
      }],
      /**
       * Ring Offset Color
       * @see https://tailwindcss.com/docs/ring-offset-color
       */
      "ring-offset-color": [{
        "ring-offset": [colors]
      }],
      // Effects
      /**
       * Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow
       */
      shadow: [{
        shadow: ["", "inner", "none", isTshirtSize, isArbitraryShadow]
      }],
      /**
       * Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow-color
       */
      "shadow-color": [{
        shadow: [isAny]
      }],
      /**
       * Opacity
       * @see https://tailwindcss.com/docs/opacity
       */
      opacity: [{
        opacity: [opacity]
      }],
      /**
       * Mix Blend Mode
       * @see https://tailwindcss.com/docs/mix-blend-mode
       */
      "mix-blend": [{
        "mix-blend": [...getBlendModes(), "plus-lighter", "plus-darker"]
      }],
      /**
       * Background Blend Mode
       * @see https://tailwindcss.com/docs/background-blend-mode
       */
      "bg-blend": [{
        "bg-blend": getBlendModes()
      }],
      // Filters
      /**
       * Filter
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/filter
       */
      filter: [{
        filter: ["", "none"]
      }],
      /**
       * Blur
       * @see https://tailwindcss.com/docs/blur
       */
      blur: [{
        blur: [blur]
      }],
      /**
       * Brightness
       * @see https://tailwindcss.com/docs/brightness
       */
      brightness: [{
        brightness: [brightness]
      }],
      /**
       * Contrast
       * @see https://tailwindcss.com/docs/contrast
       */
      contrast: [{
        contrast: [contrast]
      }],
      /**
       * Drop Shadow
       * @see https://tailwindcss.com/docs/drop-shadow
       */
      "drop-shadow": [{
        "drop-shadow": ["", "none", isTshirtSize, isArbitraryValue]
      }],
      /**
       * Grayscale
       * @see https://tailwindcss.com/docs/grayscale
       */
      grayscale: [{
        grayscale: [grayscale]
      }],
      /**
       * Hue Rotate
       * @see https://tailwindcss.com/docs/hue-rotate
       */
      "hue-rotate": [{
        "hue-rotate": [hueRotate]
      }],
      /**
       * Invert
       * @see https://tailwindcss.com/docs/invert
       */
      invert: [{
        invert: [invert]
      }],
      /**
       * Saturate
       * @see https://tailwindcss.com/docs/saturate
       */
      saturate: [{
        saturate: [saturate]
      }],
      /**
       * Sepia
       * @see https://tailwindcss.com/docs/sepia
       */
      sepia: [{
        sepia: [sepia]
      }],
      /**
       * Backdrop Filter
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://tailwindcss.com/docs/backdrop-filter
       */
      "backdrop-filter": [{
        "backdrop-filter": ["", "none"]
      }],
      /**
       * Backdrop Blur
       * @see https://tailwindcss.com/docs/backdrop-blur
       */
      "backdrop-blur": [{
        "backdrop-blur": [blur]
      }],
      /**
       * Backdrop Brightness
       * @see https://tailwindcss.com/docs/backdrop-brightness
       */
      "backdrop-brightness": [{
        "backdrop-brightness": [brightness]
      }],
      /**
       * Backdrop Contrast
       * @see https://tailwindcss.com/docs/backdrop-contrast
       */
      "backdrop-contrast": [{
        "backdrop-contrast": [contrast]
      }],
      /**
       * Backdrop Grayscale
       * @see https://tailwindcss.com/docs/backdrop-grayscale
       */
      "backdrop-grayscale": [{
        "backdrop-grayscale": [grayscale]
      }],
      /**
       * Backdrop Hue Rotate
       * @see https://tailwindcss.com/docs/backdrop-hue-rotate
       */
      "backdrop-hue-rotate": [{
        "backdrop-hue-rotate": [hueRotate]
      }],
      /**
       * Backdrop Invert
       * @see https://tailwindcss.com/docs/backdrop-invert
       */
      "backdrop-invert": [{
        "backdrop-invert": [invert]
      }],
      /**
       * Backdrop Opacity
       * @see https://tailwindcss.com/docs/backdrop-opacity
       */
      "backdrop-opacity": [{
        "backdrop-opacity": [opacity]
      }],
      /**
       * Backdrop Saturate
       * @see https://tailwindcss.com/docs/backdrop-saturate
       */
      "backdrop-saturate": [{
        "backdrop-saturate": [saturate]
      }],
      /**
       * Backdrop Sepia
       * @see https://tailwindcss.com/docs/backdrop-sepia
       */
      "backdrop-sepia": [{
        "backdrop-sepia": [sepia]
      }],
      // Tables
      /**
       * Border Collapse
       * @see https://tailwindcss.com/docs/border-collapse
       */
      "border-collapse": [{
        border: ["collapse", "separate"]
      }],
      /**
       * Border Spacing
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing": [{
        "border-spacing": [borderSpacing]
      }],
      /**
       * Border Spacing X
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-x": [{
        "border-spacing-x": [borderSpacing]
      }],
      /**
       * Border Spacing Y
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-y": [{
        "border-spacing-y": [borderSpacing]
      }],
      /**
       * Table Layout
       * @see https://tailwindcss.com/docs/table-layout
       */
      "table-layout": [{
        table: ["auto", "fixed"]
      }],
      /**
       * Caption Side
       * @see https://tailwindcss.com/docs/caption-side
       */
      caption: [{
        caption: ["top", "bottom"]
      }],
      // Transitions and Animation
      /**
       * Tranisition Property
       * @see https://tailwindcss.com/docs/transition-property
       */
      transition: [{
        transition: ["none", "all", "", "colors", "opacity", "shadow", "transform", isArbitraryValue]
      }],
      /**
       * Transition Duration
       * @see https://tailwindcss.com/docs/transition-duration
       */
      duration: [{
        duration: getNumberAndArbitrary()
      }],
      /**
       * Transition Timing Function
       * @see https://tailwindcss.com/docs/transition-timing-function
       */
      ease: [{
        ease: ["linear", "in", "out", "in-out", isArbitraryValue]
      }],
      /**
       * Transition Delay
       * @see https://tailwindcss.com/docs/transition-delay
       */
      delay: [{
        delay: getNumberAndArbitrary()
      }],
      /**
       * Animation
       * @see https://tailwindcss.com/docs/animation
       */
      animate: [{
        animate: ["none", "spin", "ping", "pulse", "bounce", isArbitraryValue]
      }],
      // Transforms
      /**
       * Transform
       * @see https://tailwindcss.com/docs/transform
       */
      transform: [{
        transform: ["", "gpu", "none"]
      }],
      /**
       * Scale
       * @see https://tailwindcss.com/docs/scale
       */
      scale: [{
        scale: [scale]
      }],
      /**
       * Scale X
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-x": [{
        "scale-x": [scale]
      }],
      /**
       * Scale Y
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-y": [{
        "scale-y": [scale]
      }],
      /**
       * Rotate
       * @see https://tailwindcss.com/docs/rotate
       */
      rotate: [{
        rotate: [isInteger, isArbitraryValue]
      }],
      /**
       * Translate X
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-x": [{
        "translate-x": [translate]
      }],
      /**
       * Translate Y
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-y": [{
        "translate-y": [translate]
      }],
      /**
       * Skew X
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-x": [{
        "skew-x": [skew]
      }],
      /**
       * Skew Y
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-y": [{
        "skew-y": [skew]
      }],
      /**
       * Transform Origin
       * @see https://tailwindcss.com/docs/transform-origin
       */
      "transform-origin": [{
        origin: ["center", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left", isArbitraryValue]
      }],
      // Interactivity
      /**
       * Accent Color
       * @see https://tailwindcss.com/docs/accent-color
       */
      accent: [{
        accent: ["auto", colors]
      }],
      /**
       * Appearance
       * @see https://tailwindcss.com/docs/appearance
       */
      appearance: [{
        appearance: ["none", "auto"]
      }],
      /**
       * Cursor
       * @see https://tailwindcss.com/docs/cursor
       */
      cursor: [{
        cursor: ["auto", "default", "pointer", "wait", "text", "move", "help", "not-allowed", "none", "context-menu", "progress", "cell", "crosshair", "vertical-text", "alias", "copy", "no-drop", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out", isArbitraryValue]
      }],
      /**
       * Caret Color
       * @see https://tailwindcss.com/docs/just-in-time-mode#caret-color-utilities
       */
      "caret-color": [{
        caret: [colors]
      }],
      /**
       * Pointer Events
       * @see https://tailwindcss.com/docs/pointer-events
       */
      "pointer-events": [{
        "pointer-events": ["none", "auto"]
      }],
      /**
       * Resize
       * @see https://tailwindcss.com/docs/resize
       */
      resize: [{
        resize: ["none", "y", "x", ""]
      }],
      /**
       * Scroll Behavior
       * @see https://tailwindcss.com/docs/scroll-behavior
       */
      "scroll-behavior": [{
        scroll: ["auto", "smooth"]
      }],
      /**
       * Scroll Margin
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-m": [{
        "scroll-m": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin X
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mx": [{
        "scroll-mx": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin Y
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-my": [{
        "scroll-my": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ms": [{
        "scroll-ms": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-me": [{
        "scroll-me": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin Top
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mt": [{
        "scroll-mt": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin Right
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mr": [{
        "scroll-mr": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin Bottom
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mb": [{
        "scroll-mb": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Margin Left
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ml": [{
        "scroll-ml": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-p": [{
        "scroll-p": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding X
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-px": [{
        "scroll-px": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding Y
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-py": [{
        "scroll-py": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-ps": [{
        "scroll-ps": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pe": [{
        "scroll-pe": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding Top
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pt": [{
        "scroll-pt": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding Right
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pr": [{
        "scroll-pr": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding Bottom
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pb": [{
        "scroll-pb": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Padding Left
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pl": [{
        "scroll-pl": getSpacingWithArbitrary()
      }],
      /**
       * Scroll Snap Align
       * @see https://tailwindcss.com/docs/scroll-snap-align
       */
      "snap-align": [{
        snap: ["start", "end", "center", "align-none"]
      }],
      /**
       * Scroll Snap Stop
       * @see https://tailwindcss.com/docs/scroll-snap-stop
       */
      "snap-stop": [{
        snap: ["normal", "always"]
      }],
      /**
       * Scroll Snap Type
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-type": [{
        snap: ["none", "x", "y", "both"]
      }],
      /**
       * Scroll Snap Type Strictness
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-strictness": [{
        snap: ["mandatory", "proximity"]
      }],
      /**
       * Touch Action
       * @see https://tailwindcss.com/docs/touch-action
       */
      touch: [{
        touch: ["auto", "none", "manipulation"]
      }],
      /**
       * Touch Action X
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-x": [{
        "touch-pan": ["x", "left", "right"]
      }],
      /**
       * Touch Action Y
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-y": [{
        "touch-pan": ["y", "up", "down"]
      }],
      /**
       * Touch Action Pinch Zoom
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-pz": ["touch-pinch-zoom"],
      /**
       * User Select
       * @see https://tailwindcss.com/docs/user-select
       */
      select: [{
        select: ["none", "text", "all", "auto"]
      }],
      /**
       * Will Change
       * @see https://tailwindcss.com/docs/will-change
       */
      "will-change": [{
        "will-change": ["auto", "scroll", "contents", "transform", isArbitraryValue]
      }],
      // SVG
      /**
       * Fill
       * @see https://tailwindcss.com/docs/fill
       */
      fill: [{
        fill: [colors, "none"]
      }],
      /**
       * Stroke Width
       * @see https://tailwindcss.com/docs/stroke-width
       */
      "stroke-w": [{
        stroke: [isLength, isArbitraryLength, isArbitraryNumber]
      }],
      /**
       * Stroke
       * @see https://tailwindcss.com/docs/stroke
       */
      stroke: [{
        stroke: [colors, "none"]
      }],
      // Accessibility
      /**
       * Screen Readers
       * @see https://tailwindcss.com/docs/screen-readers
       */
      sr: ["sr-only", "not-sr-only"],
      /**
       * Forced Color Adjust
       * @see https://tailwindcss.com/docs/forced-color-adjust
       */
      "forced-color-adjust": [{
        "forced-color-adjust": ["auto", "none"]
      }]
    },
    conflictingClassGroups: {
      overflow: ["overflow-x", "overflow-y"],
      overscroll: ["overscroll-x", "overscroll-y"],
      inset: ["inset-x", "inset-y", "start", "end", "top", "right", "bottom", "left"],
      "inset-x": ["right", "left"],
      "inset-y": ["top", "bottom"],
      flex: ["basis", "grow", "shrink"],
      gap: ["gap-x", "gap-y"],
      p: ["px", "py", "ps", "pe", "pt", "pr", "pb", "pl"],
      px: ["pr", "pl"],
      py: ["pt", "pb"],
      m: ["mx", "my", "ms", "me", "mt", "mr", "mb", "ml"],
      mx: ["mr", "ml"],
      my: ["mt", "mb"],
      size: ["w", "h"],
      "font-size": ["leading"],
      "fvn-normal": ["fvn-ordinal", "fvn-slashed-zero", "fvn-figure", "fvn-spacing", "fvn-fraction"],
      "fvn-ordinal": ["fvn-normal"],
      "fvn-slashed-zero": ["fvn-normal"],
      "fvn-figure": ["fvn-normal"],
      "fvn-spacing": ["fvn-normal"],
      "fvn-fraction": ["fvn-normal"],
      "line-clamp": ["display", "overflow"],
      rounded: ["rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded-ss", "rounded-se", "rounded-ee", "rounded-es", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
      "rounded-s": ["rounded-ss", "rounded-es"],
      "rounded-e": ["rounded-se", "rounded-ee"],
      "rounded-t": ["rounded-tl", "rounded-tr"],
      "rounded-r": ["rounded-tr", "rounded-br"],
      "rounded-b": ["rounded-br", "rounded-bl"],
      "rounded-l": ["rounded-tl", "rounded-bl"],
      "border-spacing": ["border-spacing-x", "border-spacing-y"],
      "border-w": ["border-w-s", "border-w-e", "border-w-t", "border-w-r", "border-w-b", "border-w-l"],
      "border-w-x": ["border-w-r", "border-w-l"],
      "border-w-y": ["border-w-t", "border-w-b"],
      "border-color": ["border-color-s", "border-color-e", "border-color-t", "border-color-r", "border-color-b", "border-color-l"],
      "border-color-x": ["border-color-r", "border-color-l"],
      "border-color-y": ["border-color-t", "border-color-b"],
      "scroll-m": ["scroll-mx", "scroll-my", "scroll-ms", "scroll-me", "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml"],
      "scroll-mx": ["scroll-mr", "scroll-ml"],
      "scroll-my": ["scroll-mt", "scroll-mb"],
      "scroll-p": ["scroll-px", "scroll-py", "scroll-ps", "scroll-pe", "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl"],
      "scroll-px": ["scroll-pr", "scroll-pl"],
      "scroll-py": ["scroll-pt", "scroll-pb"],
      touch: ["touch-x", "touch-y", "touch-pz"],
      "touch-x": ["touch"],
      "touch-y": ["touch"],
      "touch-pz": ["touch"]
    },
    conflictingClassGroupModifiers: {
      "font-size": ["leading"]
    }
  };
};
const twMerge = /* @__PURE__ */ createTailwindMerge(getDefaultConfig);
function cn(...inputs) {
  return twMerge(clsx(inputs));
}
const createStoreImpl = (createState) => {
  let state;
  const listeners2 = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners2.forEach((listener) => listener(state, previousState));
    }
  };
  const getState2 = () => state;
  const getInitialState = () => initialState;
  const subscribe = (listener) => {
    listeners2.add(listener);
    return () => listeners2.delete(listener);
  };
  const api = { setState, getState: getState2, getInitialState, subscribe };
  const initialState = state = createState(setState, getState2, api);
  return api;
};
const createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;
const identity = (arg) => arg;
function useStore(api, selector = identity) {
  const slice2 = React$1.useSyncExternalStore(
    api.subscribe,
    React$1.useCallback(() => selector(api.getState()), [api, selector]),
    React$1.useCallback(() => selector(api.getInitialState()), [api, selector])
  );
  React$1.useDebugValue(slice2);
  return slice2;
}
const createImpl = (createState) => {
  const api = createStore(createState);
  const useBoundStore = (selector) => useStore(api, selector);
  Object.assign(useBoundStore, api);
  return useBoundStore;
};
const create = (createState) => createState ? createImpl(createState) : createImpl;
function createJSONStorage(getStorage, options) {
  let storage;
  try {
    storage = getStorage();
  } catch (e) {
    return;
  }
  const persistStorage = {
    getItem: (name) => {
      var _a;
      const parse2 = (str2) => {
        if (str2 === null) {
          return null;
        }
        return JSON.parse(str2, void 0);
      };
      const str = (_a = storage.getItem(name)) != null ? _a : null;
      if (str instanceof Promise) {
        return str.then(parse2);
      }
      return parse2(str);
    },
    setItem: (name, newValue) => storage.setItem(name, JSON.stringify(newValue, void 0)),
    removeItem: (name) => storage.removeItem(name)
  };
  return persistStorage;
}
const toThenable = (fn) => (input) => {
  try {
    const result = fn(input);
    if (result instanceof Promise) {
      return result;
    }
    return {
      then(onFulfilled) {
        return toThenable(onFulfilled)(result);
      },
      catch(_onRejected) {
        return this;
      }
    };
  } catch (e) {
    return {
      then(_onFulfilled) {
        return this;
      },
      catch(onRejected) {
        return toThenable(onRejected)(e);
      }
    };
  }
};
const persistImpl = (config, baseOptions) => (set, get2, api) => {
  let options = {
    storage: createJSONStorage(() => window.localStorage),
    partialize: (state) => state,
    version: 0,
    merge: (persistedState, currentState) => ({
      ...currentState,
      ...persistedState
    }),
    ...baseOptions
  };
  let hasHydrated = false;
  let hydrationVersion = 0;
  const hydrationListeners = /* @__PURE__ */ new Set();
  const finishHydrationListeners = /* @__PURE__ */ new Set();
  let storage = options.storage;
  if (!storage) {
    return config(
      (...args) => {
        console.warn(
          `[zustand persist middleware] Unable to update item '${options.name}', the given storage is currently unavailable.`
        );
        set(...args);
      },
      get2,
      api
    );
  }
  const setItem = () => {
    const state = options.partialize({ ...get2() });
    return storage.setItem(options.name, {
      state,
      version: options.version
    });
  };
  const savedSetState = api.setState;
  api.setState = (state, replace) => {
    savedSetState(state, replace);
    return setItem();
  };
  const configResult = config(
    (...args) => {
      set(...args);
      return setItem();
    },
    get2,
    api
  );
  api.getInitialState = () => configResult;
  let stateFromStorage;
  const hydrate = () => {
    var _a, _b;
    if (!storage) return;
    const currentVersion = ++hydrationVersion;
    hasHydrated = false;
    hydrationListeners.forEach((cb2) => {
      var _a2;
      return cb2((_a2 = get2()) != null ? _a2 : configResult);
    });
    const postRehydrationCallback = ((_b = options.onRehydrateStorage) == null ? void 0 : _b.call(options, (_a = get2()) != null ? _a : configResult)) || void 0;
    return toThenable(storage.getItem.bind(storage))(options.name).then((deserializedStorageValue) => {
      if (deserializedStorageValue) {
        if (typeof deserializedStorageValue.version === "number" && deserializedStorageValue.version !== options.version) {
          if (options.migrate) {
            const migration = options.migrate(
              deserializedStorageValue.state,
              deserializedStorageValue.version
            );
            if (migration instanceof Promise) {
              return migration.then((result) => [true, result]);
            }
            return [true, migration];
          }
          console.error(
            `State loaded from storage couldn't be migrated since no migrate function was provided`
          );
        } else {
          return [false, deserializedStorageValue.state];
        }
      }
      return [false, void 0];
    }).then((migrationResult) => {
      var _a2;
      if (currentVersion !== hydrationVersion) {
        return;
      }
      const [migrated, migratedState] = migrationResult;
      stateFromStorage = options.merge(
        migratedState,
        (_a2 = get2()) != null ? _a2 : configResult
      );
      set(stateFromStorage, true);
      if (migrated) {
        return setItem();
      }
    }).then(() => {
      if (currentVersion !== hydrationVersion) {
        return;
      }
      postRehydrationCallback == null ? void 0 : postRehydrationCallback(stateFromStorage, void 0);
      stateFromStorage = get2();
      hasHydrated = true;
      finishHydrationListeners.forEach((cb2) => cb2(stateFromStorage));
    }).catch((e) => {
      if (currentVersion !== hydrationVersion) {
        return;
      }
      postRehydrationCallback == null ? void 0 : postRehydrationCallback(void 0, e);
    });
  };
  api.persist = {
    setOptions: (newOptions) => {
      options = {
        ...options,
        ...newOptions
      };
      if (newOptions.storage) {
        storage = newOptions.storage;
      }
    },
    clearStorage: () => {
      storage == null ? void 0 : storage.removeItem(options.name);
    },
    getOptions: () => options,
    rehydrate: () => hydrate(),
    hasHydrated: () => hasHydrated,
    onHydrate: (cb2) => {
      hydrationListeners.add(cb2);
      return () => {
        hydrationListeners.delete(cb2);
      };
    },
    onFinishHydration: (cb2) => {
      finishHydrationListeners.add(cb2);
      return () => {
        finishHydrationListeners.delete(cb2);
      };
    }
  };
  if (!options.skipHydration) {
    hydrate();
  }
  return stateFromStorage || configResult;
};
const persist = persistImpl;
const {
  slice,
  forEach
} = [];
function defaults(obj) {
  forEach.call(slice.call(arguments, 1), (source) => {
    if (source) {
      for (const prop in source) {
        if (obj[prop] === void 0) obj[prop] = source[prop];
      }
    }
  });
  return obj;
}
function hasXSS(input) {
  if (typeof input !== "string") return false;
  const xssPatterns = [/<\s*script.*?>/i, /<\s*\/\s*script\s*>/i, /<\s*img.*?on\w+\s*=/i, /<\s*\w+\s*on\w+\s*=.*?>/i, /javascript\s*:/i, /vbscript\s*:/i, /expression\s*\(/i, /eval\s*\(/i, /alert\s*\(/i, /document\.cookie/i, /document\.write\s*\(/i, /window\.location/i, /innerHTML/i];
  return xssPatterns.some((pattern) => pattern.test(input));
}
const fieldContentRegExp = /^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;
const serializeCookie = function(name, val) {
  let options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {
    path: "/"
  };
  const opt = options;
  const value = encodeURIComponent(val);
  let str = `${name}=${value}`;
  if (opt.maxAge > 0) {
    const maxAge = opt.maxAge - 0;
    if (Number.isNaN(maxAge)) throw new Error("maxAge should be a Number");
    str += `; Max-Age=${Math.floor(maxAge)}`;
  }
  if (opt.domain) {
    if (!fieldContentRegExp.test(opt.domain)) {
      throw new TypeError("option domain is invalid");
    }
    str += `; Domain=${opt.domain}`;
  }
  if (opt.path) {
    if (!fieldContentRegExp.test(opt.path)) {
      throw new TypeError("option path is invalid");
    }
    str += `; Path=${opt.path}`;
  }
  if (opt.expires) {
    if (typeof opt.expires.toUTCString !== "function") {
      throw new TypeError("option expires is invalid");
    }
    str += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) str += "; HttpOnly";
  if (opt.secure) str += "; Secure";
  if (opt.sameSite) {
    const sameSite = typeof opt.sameSite === "string" ? opt.sameSite.toLowerCase() : opt.sameSite;
    switch (sameSite) {
      case true:
        str += "; SameSite=Strict";
        break;
      case "lax":
        str += "; SameSite=Lax";
        break;
      case "strict":
        str += "; SameSite=Strict";
        break;
      case "none":
        str += "; SameSite=None";
        break;
      default:
        throw new TypeError("option sameSite is invalid");
    }
  }
  if (opt.partitioned) str += "; Partitioned";
  return str;
};
const cookie = {
  create(name, value, minutes, domain) {
    let cookieOptions = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : {
      path: "/",
      sameSite: "strict"
    };
    if (minutes) {
      cookieOptions.expires = /* @__PURE__ */ new Date();
      cookieOptions.expires.setTime(cookieOptions.expires.getTime() + minutes * 60 * 1e3);
    }
    if (domain) cookieOptions.domain = domain;
    document.cookie = serializeCookie(name, value, cookieOptions);
  },
  read(name) {
    const nameEQ = `${name}=`;
    const ca2 = document.cookie.split(";");
    for (let i = 0; i < ca2.length; i++) {
      let c = ca2[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  },
  remove(name, domain) {
    this.create(name, "", -1, domain);
  }
};
var cookie$1 = {
  name: "cookie",
  // Deconstruct the options object and extract the lookupCookie property
  lookup(_ref) {
    let {
      lookupCookie
    } = _ref;
    if (lookupCookie && typeof document !== "undefined") {
      return cookie.read(lookupCookie) || void 0;
    }
    return void 0;
  },
  // Deconstruct the options object and extract the lookupCookie, cookieMinutes, cookieDomain, and cookieOptions properties
  cacheUserLanguage(lng, _ref2) {
    let {
      lookupCookie,
      cookieMinutes,
      cookieDomain,
      cookieOptions
    } = _ref2;
    if (lookupCookie && typeof document !== "undefined") {
      cookie.create(lookupCookie, lng, cookieMinutes, cookieDomain, cookieOptions);
    }
  }
};
var querystring = {
  name: "querystring",
  // Deconstruct the options object and extract the lookupQuerystring property
  lookup(_ref) {
    let {
      lookupQuerystring
    } = _ref;
    let found;
    if (typeof window !== "undefined") {
      let {
        search
      } = window.location;
      if (!window.location.search && window.location.hash?.indexOf("?") > -1) {
        search = window.location.hash.substring(window.location.hash.indexOf("?"));
      }
      const query = search.substring(1);
      const params = query.split("&");
      for (let i = 0; i < params.length; i++) {
        const pos = params[i].indexOf("=");
        if (pos > 0) {
          const key = params[i].substring(0, pos);
          if (key === lookupQuerystring) {
            found = params[i].substring(pos + 1);
          }
        }
      }
    }
    return found;
  }
};
var hash = {
  name: "hash",
  // Deconstruct the options object and extract the lookupHash property and the lookupFromHashIndex property
  lookup(_ref) {
    let {
      lookupHash,
      lookupFromHashIndex
    } = _ref;
    let found;
    if (typeof window !== "undefined") {
      const {
        hash: hash2
      } = window.location;
      if (hash2 && hash2.length > 2) {
        const query = hash2.substring(1);
        if (lookupHash) {
          const params = query.split("&");
          for (let i = 0; i < params.length; i++) {
            const pos = params[i].indexOf("=");
            if (pos > 0) {
              const key = params[i].substring(0, pos);
              if (key === lookupHash) {
                found = params[i].substring(pos + 1);
              }
            }
          }
        }
        if (found) return found;
        if (!found && lookupFromHashIndex > -1) {
          const language = hash2.match(/\/([a-zA-Z-]*)/g);
          if (!Array.isArray(language)) return void 0;
          const index = typeof lookupFromHashIndex === "number" ? lookupFromHashIndex : 0;
          return language[index]?.replace("/", "");
        }
      }
    }
    return found;
  }
};
let hasLocalStorageSupport = null;
const localStorageAvailable = () => {
  if (hasLocalStorageSupport !== null) return hasLocalStorageSupport;
  try {
    hasLocalStorageSupport = typeof window !== "undefined" && window.localStorage !== null;
    if (!hasLocalStorageSupport) {
      return false;
    }
    const testKey = "i18next.translate.boo";
    window.localStorage.setItem(testKey, "foo");
    window.localStorage.removeItem(testKey);
  } catch (e) {
    hasLocalStorageSupport = false;
  }
  return hasLocalStorageSupport;
};
var localStorage$1 = {
  name: "localStorage",
  // Deconstruct the options object and extract the lookupLocalStorage property
  lookup(_ref) {
    let {
      lookupLocalStorage
    } = _ref;
    if (lookupLocalStorage && localStorageAvailable()) {
      return window.localStorage.getItem(lookupLocalStorage) || void 0;
    }
    return void 0;
  },
  // Deconstruct the options object and extract the lookupLocalStorage property
  cacheUserLanguage(lng, _ref2) {
    let {
      lookupLocalStorage
    } = _ref2;
    if (lookupLocalStorage && localStorageAvailable()) {
      window.localStorage.setItem(lookupLocalStorage, lng);
    }
  }
};
let hasSessionStorageSupport = null;
const sessionStorageAvailable = () => {
  if (hasSessionStorageSupport !== null) return hasSessionStorageSupport;
  try {
    hasSessionStorageSupport = typeof window !== "undefined" && window.sessionStorage !== null;
    if (!hasSessionStorageSupport) {
      return false;
    }
    const testKey = "i18next.translate.boo";
    window.sessionStorage.setItem(testKey, "foo");
    window.sessionStorage.removeItem(testKey);
  } catch (e) {
    hasSessionStorageSupport = false;
  }
  return hasSessionStorageSupport;
};
var sessionStorage$1 = {
  name: "sessionStorage",
  lookup(_ref) {
    let {
      lookupSessionStorage
    } = _ref;
    if (lookupSessionStorage && sessionStorageAvailable()) {
      return window.sessionStorage.getItem(lookupSessionStorage) || void 0;
    }
    return void 0;
  },
  cacheUserLanguage(lng, _ref2) {
    let {
      lookupSessionStorage
    } = _ref2;
    if (lookupSessionStorage && sessionStorageAvailable()) {
      window.sessionStorage.setItem(lookupSessionStorage, lng);
    }
  }
};
var navigator$1 = {
  name: "navigator",
  lookup(options) {
    const found = [];
    if (typeof navigator !== "undefined") {
      const {
        languages,
        userLanguage,
        language
      } = navigator;
      if (languages) {
        for (let i = 0; i < languages.length; i++) {
          found.push(languages[i]);
        }
      }
      if (userLanguage) {
        found.push(userLanguage);
      }
      if (language) {
        found.push(language);
      }
    }
    return found.length > 0 ? found : void 0;
  }
};
var htmlTag = {
  name: "htmlTag",
  // Deconstruct the options object and extract the htmlTag property
  lookup(_ref) {
    let {
      htmlTag: htmlTag2
    } = _ref;
    let found;
    const internalHtmlTag = htmlTag2 || (typeof document !== "undefined" ? document.documentElement : null);
    if (internalHtmlTag && typeof internalHtmlTag.getAttribute === "function") {
      found = internalHtmlTag.getAttribute("lang");
    }
    return found;
  }
};
var path = {
  name: "path",
  // Deconstruct the options object and extract the lookupFromPathIndex property
  lookup(_ref) {
    let {
      lookupFromPathIndex
    } = _ref;
    if (typeof window === "undefined") return void 0;
    const language = window.location.pathname.match(/\/([a-zA-Z-]*)/g);
    if (!Array.isArray(language)) return void 0;
    const index = typeof lookupFromPathIndex === "number" ? lookupFromPathIndex : 0;
    return language[index]?.replace("/", "");
  }
};
var subdomain = {
  name: "subdomain",
  lookup(_ref) {
    let {
      lookupFromSubdomainIndex
    } = _ref;
    const internalLookupFromSubdomainIndex = typeof lookupFromSubdomainIndex === "number" ? lookupFromSubdomainIndex + 1 : 1;
    const language = typeof window !== "undefined" && window.location?.hostname?.match(/^(\w{2,5})\.(([a-z0-9-]{1,63}\.[a-z]{2,6})|localhost)/i);
    if (!language) return void 0;
    return language[internalLookupFromSubdomainIndex];
  }
};
let canCookies = false;
try {
  document.cookie;
  canCookies = true;
} catch (e) {
}
const order = ["querystring", "cookie", "localStorage", "sessionStorage", "navigator", "htmlTag"];
if (!canCookies) order.splice(1, 1);
const getDefaults = () => ({
  order,
  lookupQuerystring: "lng",
  lookupCookie: "i18next",
  lookupLocalStorage: "i18nextLng",
  lookupSessionStorage: "i18nextLng",
  // cache user language
  caches: ["localStorage"],
  excludeCacheFor: ["cimode"],
  // cookieMinutes: 10,
  // cookieDomain: 'myDomain'
  convertDetectedLanguage: (l2) => l2
});
class Browser {
  constructor(services) {
    let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    this.type = "languageDetector";
    this.detectors = {};
    this.init(services, options);
  }
  init() {
    let services = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {
      languageUtils: {}
    };
    let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    let i18nOptions = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    this.services = services;
    this.options = defaults(options, this.options || {}, getDefaults());
    if (typeof this.options.convertDetectedLanguage === "string" && this.options.convertDetectedLanguage.indexOf("15897") > -1) {
      this.options.convertDetectedLanguage = (l2) => l2.replace("-", "_");
    }
    if (this.options.lookupFromUrlIndex) this.options.lookupFromPathIndex = this.options.lookupFromUrlIndex;
    this.i18nOptions = i18nOptions;
    this.addDetector(cookie$1);
    this.addDetector(querystring);
    this.addDetector(localStorage$1);
    this.addDetector(sessionStorage$1);
    this.addDetector(navigator$1);
    this.addDetector(htmlTag);
    this.addDetector(path);
    this.addDetector(subdomain);
    this.addDetector(hash);
  }
  addDetector(detector) {
    this.detectors[detector.name] = detector;
    return this;
  }
  detect() {
    let detectionOrder = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : this.options.order;
    let detected = [];
    detectionOrder.forEach((detectorName) => {
      if (this.detectors[detectorName]) {
        let lookup = this.detectors[detectorName].lookup(this.options);
        if (lookup && typeof lookup === "string") lookup = [lookup];
        if (lookup) detected = detected.concat(lookup);
      }
    });
    detected = detected.filter((d) => d !== void 0 && d !== null && !hasXSS(d)).map((d) => this.options.convertDetectedLanguage(d));
    if (this.services && this.services.languageUtils && this.services.languageUtils.getBestMatchFromCodes) return detected;
    return detected.length > 0 ? detected[0] : null;
  }
  cacheUserLanguage(lng) {
    let caches = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : this.options.caches;
    if (!caches) return;
    if (this.options.excludeCacheFor && this.options.excludeCacheFor.indexOf(lng) > -1) return;
    caches.forEach((cacheName) => {
      if (this.detectors[cacheName]) this.detectors[cacheName].cacheUserLanguage(lng, this.options);
    });
  }
}
Browser.type = "languageDetector";
const header$1 = {
  switchToEnglish: "Switch to English",
  switchToChinese: "切换到中文"
};
const nav$1 = {
  dashboard: "仪表盘",
  providers: "供应商",
  aggregate: "聚合渠道",
  channels: "账号渠道",
  proxy: "代理设置",
  models: "模型管理",
  logs: "日志",
  settings: "设置",
  gatewayManager: "网关管理",
  about: "关于"
};
const dashboard$1 = {
  title: "仪表盘",
  description: "系统概览和实时监控",
  running: "运行中",
  stopped: "已停止",
  totalRequests: "总请求数",
  successRate: "成功率",
  avgLatency: "平均延迟",
  avgResponseTime: "平均响应时间",
  activeAccountCount: "活跃账户数",
  port: "端口",
  startProxy: "启动代理",
  stopProxy: "停止代理",
  recentActivity: "最近活动",
  noActivity: "暂无活动记录",
  requestsTrend: "请求趋势",
  chartEmptyHint: "代理接收请求后，这里会显示流量趋势。",
  chartDayNotRetained: "无保留数据",
  trendUnavailable: "无对照数据",
  chartRetentionGap: "以下日期早于统计起点，没有数据：{{days}}",
  tokenUsage: {
    title: "今日 Token",
    upstream: "上游上报",
    estimated: "本地估算",
    estimatedHint: "上游未回报用量时按约 4 字符 / token 折算，仅用于本地计量，不能当作账单",
    coverage: "其中 {{percent}} 的请求有上游真值",
    cacheRead: "其中缓存命中",
    cacheReadHint: "上游报明的“命中缓存的输入 token”占其上报输入总量的比例。这一行只在上游真的报了这个数时出现——不出现不等于缓存没生效，只代表这一路没有可测的真值。",
    saved: "压缩节省",
    savedHint: "仅统计真正生效的压缩",
    savedDisabled: "上下文压缩未启用",
    savedDisabledHint: "这一项显示「-」而不是 0：压缩开关处于关闭状态，今天从来没有产生过可统计的压缩，所以 0 不是「省下了 0」，而是「没有测量」。在设置里开启上下文压缩后，这一行才会变成真值。",
    noData: "今日暂无请求"
  },
  providerStats: "供应商统计",
  avgResponse: "平均响应",
  cost: "费用",
  tokenTotal: "Token",
  providerWindow: {
    today: "今天",
    days: "近{{count}}天",
    all: "全部",
    custom: "自定义",
    from: "开始",
    to: "结束",
    invalidRange: "开始日期晚于结束日期",
    outcomeFrom: "成功率与平均响应自 {{day}} 起才有按供应商记录",
    outcomeMissing: "这一时间段的日志没有按供应商记录成功数与延迟",
    probe: "探测",
    probeHint: "健康检查的探测延迟，与所选时间段无关",
    tokenMissing: "这一时间段还没有按供应商记录的 token 消耗",
    tokenFrom: "按供应商的 token 记录自 {{day}} 起",
    costHint: "只按第三方标价（models.dev）估算上游实际上报的用量；免费与套餐内模型计 $0，没有标价证据的请求不计入。本段 {{costed}}/{{requests}} 条请求可计价。",
    costMissing: "这一时间段的请求都没有价格证据，不是「没花钱」"
  },
  modelCache: {
    title: "缓存命中（按模型）",
    model: "模型",
    requests: "请求",
    upstream: "上游请求",
    input: "输入",
    cacheRead: "缓存读",
    hitRate: "命中率",
    coverageHint: "{{requests}} 条请求中 {{upstream}} 条带上游用量",
    missing: "未报告",
    noData: "该时间段没有分模型的 token 记录",
    expand: "展开全部（{{count}}）",
    collapse: "收起",
    note: "缓存读由上游自己报告，且是输入 token 的子集；没有上游用量的模型显示「-」，不显示 0%。",
    coverageNote: "本期分模型明细覆盖 {{covered}} / {{total}} 条请求；早于该功能的记录没有模型拆分，不在这张表里。"
  },
  lastUpdated: "上次更新",
  refresh: "刷新",
  browserMode: "浏览器模式",
  browserModeDesc: "您正在浏览器中预览此应用。完整功能需要在 Electron 应用中运行。",
  proxyRunning: "代理服务运行中",
  proxyStopped: "代理服务已停止",
  runtime: "运行时间",
  vsYesterday: "较昨日",
  hours: "小时",
  minutes: "分钟",
  justNow: "刚刚",
  minutesAgo: "{{count}}分钟前",
  hoursAgo: "{{count}}小时前",
  daysAgo: "{{count}}天前"
};
const providers$1 = {
  title: "供应商管理",
  subtitle: "管理您的 API 供应商配置和账户",
  addProvider: "添加供应商",
  editProvider: "编辑供应商",
  deleteProvider: "删除供应商",
  duplicateProvider: "复制供应商",
  providerName: "供应商名称",
  builtin: "内置",
  custom: "自定义",
  apiEndpoint: "API 端点",
  description: "描述",
  descriptionPlaceholder: "输入描述（可选）",
  supportedModels: "支持的模型",
  supportedModelsHelp: "点击添加或移除模型",
  models: "模型",
  modelNamePlaceholder: "输入模型名称",
  headersConfig: "请求头配置",
  headerName: "请求头名称",
  headerValue: "请求头值",
  credentialFields: "凭证",
  credentialFieldsHelp: "点击添加或移除凭证字段",
  accounts: "账户",
  accountManagement: "账户管理",
  modelUsage: "模型使用",
  providerDistribution: "供应商分布",
  addAccount: "添加账户",
  editAccount: "编辑账户",
  deleteAccount: "删除账户",
  accountName: "账户名称",
  credentials: "凭证",
  status: "状态",
  online: "在线",
  offline: "离线",
  unknown: "未知",
  checkStatus: "检测状态",
  lastCheck: "最后检测",
  dailyLimit: "每日限额",
  usedToday: "今日已用",
  confirmDelete: "确定要删除此供应商吗？",
  confirmDeleteAccount: "确定要删除此账户吗？",
  enabled: "已启用",
  disabled: "已禁用",
  providerEnabled: "供应商已启用",
  providerDisabled: "供应商已禁用",
  operationFailed: "操作失败",
  cannotUpdateProviderStatus: "无法更新供应商状态",
  deleteSuccess: "删除成功",
  providerDeleted: "供应商已删除",
  deleteFailed: "删除失败",
  cannotDeleteProvider: "无法删除供应商",
  duplicateSuccess: "复制成功",
  providerDuplicated: "供应商已复制",
  duplicateFailed: "复制失败",
  cannotDuplicateProvider: "无法复制供应商",
  providerOnline: "供应商在线",
  providerOffline: "供应商离线",
  statusUnknown: "状态未知",
  statusReasons: {
    channel_runtime_running: "账号渠道运行时正在运行",
    channel_runtime_stopped: "账号渠道运行时还没启动；发起请求时会自动拉起"
  },
  latency: "延迟",
  checkFailed: "检测失败",
  cannotCheckProviderStatus: "无法检测供应商状态",
  statusRefreshed: "状态已刷新",
  refreshFailed: "刷新失败",
  cannotRefreshProviderStatus: "无法刷新供应商状态",
  addSuccess: "添加成功",
  accountAdded: "账户已添加",
  createSuccess: "创建成功",
  customProviderCreated: "自定义供应商已创建",
  updateSuccess: "更新成功",
  providerConfigUpdated: "供应商配置已更新",
  createFailed: "创建失败",
  updateFailed: "更新失败",
  addFailed: "添加失败",
  cannotAddAccount: "无法添加账户",
  accountDeleted: "账户已删除",
  accountUpdated: "账户已更新",
  validateSuccess: "验证成功",
  credentialsValid: "凭证有效",
  validateFailed: "验证失败",
  credentialsInvalid: "凭证无效",
  justNow: "刚刚",
  loading: "加载中...",
  noProvidersFound: "没有找到供应商",
  tryAdjustingFilters: "尝试调整搜索条件或筛选器",
  clickToAddProvider: "点击上方按钮添加第一个供应商",
  backToProviderList: "返回供应商列表",
  manageAllAccounts: "管理供应商下的所有账户",
  searchProviders: "搜索供应商...",
  allTypes: "全部类型",
  enabledOnly: "仅已启用",
  disabledOnly: "仅已禁用",
  allStatus: "全部状态",
  total: "总计",
  onlineCount: "在线",
  authType: "认证方式",
  authLabels: {
    token: "API Key",
    userToken: "User Token",
    cookie: "Cookie",
    oauth: "OAuth 授权",
    refresh_token: "Refresh Token",
    jwt: "JWT",
    realUserID_token: "UserID + Token",
    tongyi_sso_ticket: "SSO Ticket"
  },
  authTokenDesc: "直接使用服务端签发的 API Key",
  authUserTokenDesc: "用户级 Token（如 DeepSeek）",
  authRefreshTokenDesc: "用 Refresh Token 换新凭证（如 GLM）",
  authJwtDesc: "JWT / Refresh Token（如 Kimi）",
  authUserIdTokenDesc: "realUserID 与 JWT 一起提交（如 MiniMax）",
  authSsoDesc: "通义 SSO ticket（如 Qwen）",
  authCookieDesc: "整段 Cookie，用于仅支持网页会话的端点",
  authOAuthDesc: "走 OAuth 授权流程，登录后自动获取凭证",
  selectProvider: "选择一个内置供应商，系统将引导您完成认证",
  builtinProviders: "内置供应商",
  customProviders: "自定义供应商",
  customProviderNotSupported: "暂不支持",
  createCustomProvider: "创建自定义供应商",
  createCustomProviderDesc: "配置您自己的 API 供应商，支持多种认证方式",
  startCreating: "开始创建",
  processing: "处理中...",
  collapse: "收起",
  active: "活跃",
  inactive: "未激活",
  expired: "已过期",
  accountNamePlaceholder: "输入账户名称",
  dailyLimitOptional: "每日限额（可选）",
  dailyLimitPlaceholder: "每日最大请求数",
  credentialsKeepHint: "凭据不会回显；留空表示保留已保存的值，填写则覆盖。",
  validationSuccess: "验证成功",
  noCredentialsRequired: "该供应商无需凭据，直接添加即可；请求由本机运行时完成。",
  quota: "配额",
  validateCredentials: "验证凭证",
  saving: "保存中...",
  saveChanges: "保存更改",
  required: "必填",
  enterApiToken: "输入 API Token",
  enterCookieString: "输入完整的 Cookie 字符串",
  enterOAuthAccessToken: "输入 OAuth Access Token",
  enterRefreshToken: "输入 Refresh Token",
  enterJwtToken: "输入 JWT Token（以 eyJ 开头）",
  fillRequiredFields: "请填写必填字段: {{fields}}",
  enterAccountName: "请输入账户名称",
  saveFailed: "保存失败",
  last7days: "最近 7 天",
  sampleData: "示例数据",
  updateModels: "更新模型",
  manageModels: "管理模型",
  updateModelsSuccess: "模型列表更新成功",
  updateModelsFailed: "模型列表更新失败",
  updateModelsNotSupported: "该供应商不支持动态更新模型",
  updatingModels: "正在更新模型列表...",
  updateModelsCountDesc: "拉到 {{fetched}} 条，其中 {{added}} 条是本次新增",
  updateModelsNoChangeDesc: "拉到 {{fetched}} 条，与当前清单完全重复，没有新增",
  updateModelsNoAccountDesc: "该供应商没有可用账号，在线清单需要登录态才能取",
  updateModelsMissingFieldDesc: "账号已选，但缺少清单需要的凭证字段：{{detail}}",
  updateModelsHttpStatusDesc: "上游返回非 200：{{detail}}",
  updateModelsEmptyDesc: "清单响应里没有可识别的模型条目",
  updateModelsShapeDesc: "响应结构不认识，未写入任何清单：{{detail}}",
  updateModelsNetworkDesc: "请求上游清单失败：{{detail}}",
  updateModelsInvalidKeyDesc: "已存的所有 Key 都被清单接口拒绝：{{detail}}",
  never: "从未",
  nearLimit: "剩余额度接近上限",
  providerNameRequired: "请输入名称",
  apiEndpointRequired: "请输入 API 地址",
  apiEndpointInvalid: "API 地址无效"
};
const proxy$1 = {
  title: "代理设置",
  description: "配置 API 代理服务参数和管理策略",
  statistics: "运行统计",
  basicConfig: "基础配置",
  basicConfigDesc: "配置代理服务的基本参数",
  loadingSettings: "正在读取已保存的代理设置…（读到之前不显示输入框，避免把默认值当成现状保存）",
  loadBalancing: "负载均衡",
  advancedConfig: "高级配置",
  advancedConfigDesc: "配置超时、重试和日志等高级选项",
  roundRobin: "轮询",
  fillFirst: "填充优先",
  failover: "故障转移",
  smart: "最早重置优先",
  pace: "余量平摊",
  modelMappingConfig: "模型映射配置",
  unsaved: "未保存",
  modelMappingDesc: "将请求模型映射到实际使用的模型",
  searchMappings: "搜索映射规则...",
  addMapping: "添加映射",
  requestModel: "请求模型",
  actualModel: "实际模型",
  preferredProvider: "优先供应商",
  preferredAccount: "优先账户",
  auto: "自动",
  noMappings: "暂无映射规则",
  noMappingsDesc: "点击「添加映射」创建新的模型映射",
  wildcardUnsupported: "不支持通配符：映射表按精确名字查找，带 * 的条目永远匹配不到。",
  saveConfig: "保存配置",
  editMapping: "编辑映射",
  addMappingDesc: "配置请求模型到实际模型的映射规则",
  requestModelPlaceholder: "gpt-4",
  requestModelHelp: "客户端请求的模型名；精确匹配",
  actualModelHelp: "实际发送给供应商的模型名称",
  selectModel: "选择模型",
  noModelFound: "未找到匹配的模型",
  preferredProviderOptional: "优先供应商（可选）",
  autoSelect: "自动选择",
  preferredAccountOptional: "优先账户（可选）",
  selectProviderFirst: "请先选择供应商",
  validationFailed: "验证失败",
  requestActualModelRequired: "请求模型和实际模型不能为空",
  mappingExists: "该请求模型已存在映射规则",
  mappingAddedPending: "模型映射 {{model}} 已添加（待保存）",
  mappingUpdatedPending: "模型映射 {{model}} 已修改（待保存）",
  mappingDeletedPending: "模型映射 {{model}} 已删除（待保存）",
  configSaved: "模型映射配置已保存",
  configSaveFailed: "保存配置失败",
  unsavedChangesWarning: "您有未保存的更改，确定要离开吗？",
  unsavedChangesHint: "您有未保存的更改，请点击保存按钮保存",
  unsavedChangesTitle: "有未保存的更改",
  unsavedChangesDescription: "您有未保存的模型映射更改。如果离开，这些更改将会丢失。",
  discardAndLeave: "放弃更改并离开",
  changesDiscarded: "已放弃未保存的更改",
  portMustBeNumber: "端口必须是数字",
  listeningPort: "监听端口",
  portRange: "代理服务监听的端口号 (1-65535)",
  portRangeError: "端口必须在 1-65535 范围内",
  portPrivilege: "低于 1024 的端口需要管理员权限",
  bindAddress: "绑定地址",
  bindAddressEmpty: "绑定地址不能为空",
  invalidIpOrHostname: "请输入有效的 IP 地址或主机名",
  bindAddressHelp: "0.0.0.0 允许所有网络访问，127.0.0.1 仅本地访问",
  httpsEnabled: "启用 HTTPS",
  httpsEnabledHelp: "额外开一个 TLS 监听给只接受 https 的客户端（如 Claude Desktop）；原 HTTP 端口继续可用。",
  httpsPort: "HTTPS 端口",
  httpsPortHelp: "不能与上面的 HTTP 端口相同",
  httpsPortConflict: "HTTPS 端口不能与 HTTP 端口相同",
  httpsClientUrl: "客户端地址",
  httpsClientUrlHelp: "填到 Claude Desktop 的 Gateway base URL；不要带 /v1，它自己会拼 /v1/messages。",
  httpsCertificate: "证书",
  httpsCertPath: "证书文件",
  httpsCertValidTo: "有效期至",
  httpsCertTrust: "系统信任",
  httpsCertTrusted: "已信任",
  httpsCertUntrusted: "未信任",
  httpsCertTrustUnknown: "无法自动判断",
  httpsCertNotGenerated: "证书会在代理首次以 HTTPS 启动时生成",
  httpsInstallTrust: "安装到系统信任",
  httpsInstalling: "正在安装...",
  httpsUninstallTrust: "从系统信任移除",
  httpsUninstalling: "正在移除...",
  httpsTrustRemoved: "证书已从信任库移除",
  httpsTrustRemoveFailed: "证书移除失败",
  httpsInstallTrustHelp: "只写入当前用户的根证书库，系统会弹一次确认；不需要管理员权限。只对读系统信任库的客户端有效（Claude Desktop、浏览器），装完请重启客户端。",
  httpsTrustInstalled: "证书已安装",
  httpsTrustFailed: "证书安装失败",
  httpsCertPairRequired: "证书和私钥必须同时填写",
  httpsCertPathLabel: "自有证书（可选）",
  httpsCertPathPlaceholder: "留空使用自动生成的证书",
  httpsKeyPathLabel: "自有私钥（可选）",
  httpsKeyPathPlaceholder: "与证书成对填写",
  httpsSanHosts: "证书包含的地址（IP，逗号分隔）",
  httpsSanHostsHelp: "远程客户端用哪个地址连，就要把那个地址写进来；localhost / 127.0.0.1 / ::1 已默认包含。改过这里证书会重新签发，需要再点一次「安装到系统信任」。",
  httpsSanInvalid: "不是有效的 IP 或域名",
  httpsCertSan: "证书包含",
  httpsRemoteTrustHint: "证书要在跑客户端的那台机器上被信任。在控制台里就是上面那块「本机」；其他电脑用 GET /v1/management/tls/ca 取同一份 PEM，在那台机器上自行安装。",
  httpsHandshakeRejections: "握手被拒",
  httpsHandshakeNone: "监听启动以来没有",
  httpsHandshakeCount: "监听启动以来 {{total}} 次，其中证书被拒 {{certificate}} 次（{{codes}}）",
  httpsNodeClientEnv: "网关主机上的 Node 客户端",
  httpsCopyCa: "复制",
  httpsNodeClientHelp: "Node 系客户端（Codex CLI、WorkBuddy/CodeBuddy 的 agent、任何走 node:https 或 undici 的客户端）不读系统信任库，只认自带 CA 集合加 NODE_EXTRA_CA_CERTS。把这个变量指向上面这个文件，再重启客户端。",
  httpsCaCopied: "环境变量已复制",
  httpsCaCopyFailed: "无法写入剪贴板",
  httpsGatewayTrust: "网关主机信任",
  httpsHandshakeGatewayNote: "计数来自网关主机：客户端拒绝的握手在那边不会留下任何请求行。",
  httpsMachineTrust: "本机（这台电脑）",
  httpsMachineTrustState: "本机信任",
  httpsMachineFingerprint: "SHA-256 指纹",
  httpsMachineCertPath: "本机证书文件",
  httpsMachineNodeEnv: "本机的 Node 客户端",
  httpsMachineUnavailable: "控制台还没拿到网关的证书，这台电脑上暂时没有可信任的东西。",
  httpsMachineInstallHelp: "只写这台电脑当前用户的根证书库，网关主机保持原样；安装前请核对指纹，装完重启客户端。",
  httpsMachineManual: "这个平台没有可由应用代执行的信任命令：请用系统工具添加上面那份证书，再核对指纹。",
  httpsBootstrapHint: "如果 https 页面本身打不开，控制台的连接失败页会直接给出同一个安装操作——证书不被信任时，页面上是没有按钮可点的。",
  saving: "保存中...",
  proxyConfigUpdated: "代理配置已更新",
  fixFormErrors: "请修正表单中的错误",
  loadBalanceConfig: "负载均衡配置",
  loadBalanceConfigDesc: "配置账户选择策略和权重分配",
  loadBalanceStrategy: "负载均衡策略",
  selectStrategy: "选择策略",
  roundRobinDesc: "按顺序依次使用每个可用账户，实现均匀分配请求",
  fillFirstDesc: "优先使用当前账户直到达到限制，然后切换到下一个账户",
  failoverDesc: "自动跳过异常账户，当账户连续失败3次后自动切换到其他账户，1分钟后自动恢复",
  smartDesc: "在可用账户里挑选额度最早恢复的那个，把快重置的额度先用掉，减少浪费",
  paceDesc: "挑选每小时剩余额度最多的账户，把额度平摊到重置之前",
  accountWeightConfig: "账户权重配置",
  repetitionGuardTitle: "退化流识别",
  repetitionGuardDesc: "把「尾部塌成重复行」的流式回答记为一次不可用成功：评分不再把它当干净战绩，会话也不会被钉在这家模型上。出厂阈值按 99 段真实 reasoning 标定（健康段中位去重率 1.000；0.80 命中其中 9 段）。",
  repetitionGuardMinLines: "参与判定的最少行数",
  repetitionGuardMaxRatio: "重复行比例阈值",
  repetitionGuardMaxRatioHelp: "尾部窗口内「不重复行 / 总行数」低于或等于该值即判为退化。客户端守卫在 0.35 中止，所以网关刻意更宽松，不抢在客户端之前定罪。",
  repetitionGuardNonStreamNote: "只覆盖流式响应。非流式没有逐块信号，正文又只在开启请求体日志时才保留，所以那条路明确不判。",
  weightHelp: "权重越高，该账户被选中的概率越大。仅在轮询策略下生效。",
  autoRoutingMaxAttempts: "失败切换次数",
  autoRoutingMaxAttemptsHelp: "单次请求在账号故障类失败（5xx、网络错误）上最多换几家就收手。排队、额度用尽、这一家已不供该模型这类可恢复失败不受它约束，会继续换家直到 90 秒墙钟预算",
  autoRoutingSticky: "会话粘性（分钟）",
  autoRoutingStickyHelp: "同一段对话在该时长内优先复用上次成功的模型，设为 0 关闭",
  autoRoutingStickyHardPin: "粘性模型硬优先（无条件排到候选队首）",
  autoRoutingStickyHardPinHelp: "开：把这段对话上次成功的模型提到候选队首，agent 会话不会中途换模型。关：粘性只作为打分加分（+0.12，同模型的另一个账号 +0.06），明显更合适的候选可以赢过它",
  autoRoutingStickyHardPinIdle: "上面的粘性时长是 0，粘性本身已关闭，这一格暂时不起作用。",
  autoRoutingFairness: "份额轮转领先档（次）",
  autoRoutingFairnessHelp: "这条路由的池里，一个模型最多可以领先「派得最少的模型」几次，超过就退到所有派得更少的模型之后。0 = 严格轮流；2 = 出厂默认，允许连派 3 次；20 基本等于只看分数。会话粘性仍然把同一段对话钉在同一个模型上。候选池现在整池参与打分（不再每家只派一个模型），这一格决定池子尾部能不能轮到。",
  autoRoutingPrefer: "路由偏好",
  autoRoutingPreferHelp: "均衡按请求复杂度挑档位，速度优先选快模型，能力优先选强模型，免费优先选不计费或低倍率的模型。请求头 X-Auto-Prefer 可按次覆盖",
  autoRoutingPrefer_balanced: "均衡（按复杂度）",
  autoRoutingPrefer_fast: "速度优先",
  autoRoutingPrefer_strong: "能力优先",
  autoRoutingPrefer_cheap: "免费优先",
  noActiveAccounts: "暂无活跃账户",
  addAndActivateAccount: "请先添加并激活账户",
  failedToGetAccounts: "获取账户列表失败",
  requestConfig: "请求配置",
  requestTimeout: "请求超时 (秒)",
  timeoutMustBeNumber: "超时时间必须是数字",
  timeoutRangeError: "超时时间必须在 1-300 秒范围内",
  timeoutHelp: "单个请求的最大等待时间 (1-300 秒)",
  retryCount: "重试次数",
  retryCountMustBeNumber: "重试次数必须是数字",
  retryCountRangeError: "重试次数必须在 0-10 范围内",
  retryCountHelp: "请求失败后的自动重试次数 (0-10 次)",
  outputCapFallback: "输出上限兜底值",
  outputCapFallbackHelp: "Anthropic 协议必须携带 max_tokens：客户端两种写法都没给、模型参数也没配时，用这个值补上。留空使用内置默认 4096。",
  outputCapMustBeInteger: "输出上限必须是整数",
  outputCapRangeError: "输出上限必须在 1-1000000 范围内",
  advancedConfigUpdated: "高级配置已更新",
  restartRequired: "需要重启",
  restartRequiredDesc: "端口或绑定地址已更改。代理服务需要重启才能使更改生效。是否立即重启？",
  restartNow: "立即重启",
  restarting: "正在重启...",
  proxyRestarted: "代理服务已使用新配置重启",
  proxyRestartFailed: "代理服务重启失败",
  autoRoutingPoolStrategy: "候选池策略筛选",
  autoRoutingPoolStrategyHelp: "勾选后只保留满足全部条件的模型。策略针对模型而非账号，同一模型的多账号一起过滤。空选即不过滤。",
  "autoRoutingPoolStrategy_vision-capable": "视觉模型",
  "autoRoutingPoolStrategy_vision-capable_desc": "能接收图片输入",
  "autoRoutingPoolStrategy_tools-capable": "工具调用",
  "autoRoutingPoolStrategy_tools-capable_desc": "原生支持函数/工具调用",
  autoRoutingPoolStrategy_multimodal: "多模态",
  autoRoutingPoolStrategy_multimodal_desc: "能接收图片输入（当前近似视觉能力）",
  autoRoutingPoolStrategy_reasoning: "推理模型",
  autoRoutingPoolStrategy_reasoning_desc: "强能力档且模型名含 reason/thinking",
  "autoRoutingPoolStrategy_annotated-only": "仅已标注能力",
  "autoRoutingPoolStrategy_annotated-only_desc": "至少一项能力有明确标注",
  "autoRoutingPoolStrategy_free-only": "仅免费模型",
  "autoRoutingPoolStrategy_free-only_desc": "成本档为免费",
  "autoRoutingPoolStrategy_low-weight": "低消耗权重",
  "autoRoutingPoolStrategy_low-weight_desc": "消耗倍率标注存在且 ≤ 1",
  "autoRoutingPoolStrategy_included-plan": "订阅额度内",
  "autoRoutingPoolStrategy_included-plan_desc": "聚合条目分类为套餐内",
  "autoRoutingPoolStrategy_cost-known": "已知成本",
  "autoRoutingPoolStrategy_cost-known_desc": "成本档既非 unknown 也非缺失",
  "autoRoutingPoolStrategy_long-context": "长上下文",
  "autoRoutingPoolStrategy_long-context_desc": "上下文窗口 ≥ 128000",
  "autoRoutingPoolStrategy_standard-context": "标准上下文",
  "autoRoutingPoolStrategy_standard-context_desc": "上下文窗口 ≥ 32000",
  "autoRoutingPoolStrategy_fast-tier": "快速档",
  "autoRoutingPoolStrategy_fast-tier_desc": "能力档位为 fast",
  "autoRoutingPoolStrategy_strong-tier": "强能力档",
  "autoRoutingPoolStrategy_strong-tier_desc": "能力档位为 strong",
  "autoRoutingPoolStrategy_balanced-tier": "均衡档",
  "autoRoutingPoolStrategy_balanced-tier_desc": "能力档位为 balanced",
  "autoRoutingPoolStrategy_aggregate-only": "仅聚合",
  "autoRoutingPoolStrategy_aggregate-only_desc": "只保留聚合供应商",
  "autoRoutingPoolStrategy_channel-only": "仅账号渠道",
  "autoRoutingPoolStrategy_channel-only_desc": "只保留账号渠道供应商",
  "autoRoutingPoolStrategy_builtin-only": "仅内置",
  "autoRoutingPoolStrategy_builtin-only_desc": "只保留内置供应商",
  "autoRoutingPoolPreset_daily-free": "日常免费",
  "autoRoutingPoolPreset_daily-free_desc": "免费且已标注能力",
  "autoRoutingPoolPreset_vision-first": "视觉优先",
  "autoRoutingPoolPreset_vision-first_desc": "视觉或多模态",
  "autoRoutingPoolPreset_long-context": "长上下文",
  "autoRoutingPoolPreset_long-context_desc": "仅保留长上下文模型",
  "autoRoutingPoolPreset_low-cost": "低成本",
  "autoRoutingPoolPreset_low-cost_desc": "免费或低消耗权重",
  "autoRoutingPoolPreset_strong-reasoning": "强推理",
  "autoRoutingPoolPreset_strong-reasoning_desc": "推理模型且强能力档",
  autoRoutingPoolOperator_and: "且",
  autoRoutingPoolOperator_or: "或",
  autoRoutingPoolOperatorHelp: "运算符从左到右依次生效：且取交集，或取并集。第一个策略的运算符被忽略。",
  autoRoutingPoolStrategyCategory_capability: "能力",
  autoRoutingPoolStrategyCategory_cost: "成本",
  autoRoutingPoolStrategyCategory_context: "上下文",
  autoRoutingPoolStrategyCategory_tier: "档位",
  autoRoutingPoolStrategyCategory_channel: "渠道",
  modelRoutes: "模型路由",
  modelRoutesDesc: "路由是一段可命名的候选池决策：请求把 model 设为路由名，就按这里的打分策略、偏好、切换次数与候选池筛选挑选模型。候选池每次请求都按当下在服务中的模型重新计算，增删模型不需要改路由。",
  modelRoutesNew: "新建路由",
  modelRoutesEmpty: "暂无路由",
  modelRoutesEmptyHelp: "新建一条后即可在请求里把 model 设为路由名；名为 auto 的路由由旧版自动模型路由配置迁移而来。",
  routesUnavailable: "路由接口不可用，请重启应用后重试",
  routesLoadFailed: "路由列表加载失败",
  routeNameLabel: "路由名",
  routeNamePlaceholder: "例如 cheap-fast",
  routeNameHelp: "小写字母、数字、下划线与连字符，最长 64 个字符；不能与已有路由、模型名或用户别名重名。",
  routeNameRequired: "请输入路由名",
  routeCreate: "创建路由",
  routeSaveChanges: "保存修改",
  routeEnabledSwitch: "启用",
  routeStrategy: "打分策略",
  routeStrategyHelp: "只决定这条路由的候选排序权重；同一供应商内部仍按上面的服务级策略挑选账号。",
  routeRename: "路由名（改名）",
  routeRenameHelp: "改成新名字即完成重命名：请求要用新名字才命中这条路由，旧名字立刻失效。",
  routeDeleteConfirmTitle: "确认删除路由「{{name}}」？",
  routeDeleteWarning_auto: '删除后 /v1/models 不再广告 auto，model="auto" 退回普通模型名解析（不再是路由）；若没有同名模型，客户端会得到未知模型错误。',
  routeDeleteWarning_other: "删除后 /v1/models 不再广告「{{name}}」，请求里的 {{name}} 退回普通模型名解析（不再是路由）；若没有同名模型，客户端会得到未知模型错误。",
  routeCreatedToast: "路由已创建并立即生效",
  routeSavedToast: "路由已更新并立即生效",
  routeUpdatedToast: "路由状态已更新并立即生效",
  routeDeletedToast: "路由已删除",
  routeImmediateHelp: "路由的新建、编辑、改名、启停与删除都会立即落盘并对下一个请求生效，无需重启代理。",
  routeAttemptsSummary: "账号故障类失败最多换 {{attempts}} 家",
  routePoolSize: "这条路由的池里现有 {{count}} 个模型",
  routePoolSizeEmpty: "这条路由的池是空的：它仍然出现在 /v1/models 里，但每次请求都会 503。放宽它的池策略，或到模型页启用更多模型。",
  routePoolSizeUnknown: "候选数读不到（当前目录读不出来）",
  routeStickySummary: "会话粘性 {{minutes}} 分钟",
  routePoolManualSummary: "手动修正：加回 {{included}} 个 · 移除 {{excluded}} 个",
  routePoolTitle: "候选池预览与手动修正",
  routePoolHelp: "预览按当前配置走与真实请求相同的采集/策略/手动增删流程，逐模型显示最终去向。被策略误筛的模型可以手动加回；不想被选中的可以手动移除。手动增删不会绕过硬过滤（图片→视觉、上下文）与契约过滤。",
  routePoolRefresh: "刷新预览",
  routePoolLoading: "正在计算候选池…",
  routePoolNoMatch: "没有符合筛选条件的模型",
  routePoolSearchPlaceholder: "搜索模型或供应商…",
  routePoolFilter_all: "全部模型",
  routePoolFilter_kept: "仅保留",
  routePoolFilter_dropped: "被筛掉或排除",
  routePoolFilter_unavailable: "当前画像不可用",
  routePoolStatus_kept: "保留",
  routePoolStatus_included: "手动加回",
  routePoolStatus_excluded: "手动移除",
  routePoolStatus_filtered: "策略筛掉",
  routePoolStatus_unavailable: "画像不可用",
  routePoolAdd: "加入候选池",
  routePoolRemove: "从候选池移除",
  "routePoolStatus_not-pinned": "未钉定",
  routePoolPin: "钉进这条路由",
  routePoolUnpin: "从钉定名单移除",
  routePoolPinnedFlag: "已钉定",
  routePinSummary: "已钉定候选池：这条路由只服务这 {{total}} 个模型名。",
  routeBasedOn: "池来源（引用另一条路由）",
  routeBasedOnNone: "自带池（不引用）",
  routeBasedOnHelp: "选一条已有的路由，这条路由的候选池、池策略、钉名与手动增删全部取自它。引用只允许一跳，所以不会出现「A 借 B、B 又借 C」。用途是给同一份池再开一个客户端入口名（例如 Anthropic 档位名），而不是复制一份会各自漂移的配置。",
  routeBasedOnNotice: "这条路由的选择行为全部来自「{{route}}」，下面的策略与手动增删不参与执行；要改这些字段请先清掉引用。",
  routeBasedOnSummary: "池来自 {{route}}（这条路由自己不执行上面的策略）",
  routePoolAuto: "恢复自动判定",
  routePoolFilteredBy: "被「{{strategy}}」筛掉",
  routePoolUnavailable_vision: "预览画像需要视觉能力",
  routePoolUnavailable_tools: "预览画像需要工具调用",
  routePoolUnavailable_context: "上下文窗口不足",
  routePoolSummary: "候选 {{candidates}} · 策略后 {{afterStrategies}} · 手动修正后 {{afterManual}} · 画像不可用 {{unavailable}}",
  routePoolConflict: "「{{strategy}}」按「或」并入，重新纳入了 {{count}} 个不满足排在它前面的策略的候选（{{broken}}）：那几条已经不再约束这个池了。",
  routePoolEmpty: "当前配置下没有可路由的模型（{{reasons}}）",
  routePoolMissing_vision: "没有视觉模型",
  routePoolMissing_tools: "没有支持工具调用的模型",
  routePoolMissing_context: "没有上下文足够的模型",
  routePoolMissing_pool_strategy: "候选池策略筛光了所有候选",
  routePoolMissing_manual_filter: "手动移除清空了候选池",
  routePoolUnresolved: "有 {{count}} 条手动加入的模型已不在候选范围（已停用或删除），可逐条移除",
  routePoolSampleVision: "预览请求需要图片",
  routePoolSampleTools: "预览请求需要工具",
  routePoolSampleTokens: "预估上下文",
  routePoolMark: "编辑能力标注",
  routePoolManualMark: "手动标注",
  routePoolMarkTitle: "手动能力标注",
  routePoolMarkHelp: "手动标注优先级最高，且不会被模型同步覆盖。「继承」表示继续使用自动解析结果（供应商记录 / 聚合官方 / 静态表 / 第三方 / 名字启发式）。",
  routePoolMarkTier: "能力档位",
  routePoolMarkVision: "视觉",
  routePoolMarkTools: "工具调用",
  routePoolMarkReasoning: "推理",
  routePoolMarkContext: "上下文窗口",
  routePoolMarkMaxOutput: "输出上限",
  routePoolMarkMaxOutputPlaceholder: "未标注（留空）",
  routePoolMarkMaxOutputHelp: "单位：tokens。留空表示未标注，不会写入 0；只接受正整数，最大 {{max}}。",
  routePoolMarkMaxOutputInvalid: "请输入正整数的 token 数（只含数字，不能为 0 或小数）。",
  routePoolMarkMaxOutputTooLarge: "输出上限不能超过 {{max}} tokens。",
  routePoolMarkModalities: "输入模态",
  routePoolMarkModalitiesHelp: "不勾选即继承自动标注；勾选后以这里的集合为准。",
  routePoolMarkInherit: "继承自动标注",
  routePoolMarkYes: "支持",
  routePoolMarkNo: "不支持",
  routePoolMarkSaveFailed: "保存标注失败",
  routePoolSource_manual: "手动标注",
  "routePoolSource_provider-record": "供应商记录",
  "routePoolSource_aggregate-official": "聚合官方目录",
  routePoolSource_catalog: "标准库（已采用）",
  routePoolSource_probe: "实测探测",
  routePoolSource_static: "内置静态表",
  "routePoolSource_provider-default": "供应商默认值",
  "routePoolSource_third-party": "第三方数据（models.dev）",
  routePoolSource_heuristic: "名字启发式",
  routePoolSource_unknown: "未知",
  routePoolSourceShort_manual: "手动",
  "routePoolSourceShort_provider-record": "记录",
  "routePoolSourceShort_aggregate-official": "官方",
  routePoolSourceShort_catalog: "标准库",
  routePoolSourceShort_probe: "实测",
  routePoolSourceShort_static: "静态",
  "routePoolSourceShort_provider-default": "默认",
  "routePoolSourceShort_third-party": "三方",
  routePoolSourceShort_heuristic: "启发",
  routePoolSourceShort_unknown: "?"
};
const gateways$1 = {
  title: "网关管理",
  description: "这台机器上可以连接的网关，以及每台网关的状态。",
  desktopOnly: "网关管理只在桌面端可用：需要在当前机器上启停、安装或部署网关。",
  refresh: "刷新",
  add: "添加网关",
  loading: "正在读取网关状态…",
  empty: "还没有配置任何网关。",
  loadFailed: "读取网关状态失败，请稍后重试。",
  current: "当前",
  phase: {
    running: "运行中",
    stopped: "已停止",
    "not-installed": "未安装",
    unreachable: "无法连接",
    offline: "离线",
    unknown: "未知"
  }
};
const apiKeys$1 = {
  title: "API Key 管理",
  description: "管理代理服务的 API Key 认证",
  apiKeyAuth: "API Key 认证",
  apiKeyAuthDesc: "启用后，所有请求需要携带 API Key",
  enableApiKeyAuth: "启用认证",
  currentStatus: "状态",
  apiKeyList: "API Key 列表",
  totalKeys: "共 {{count}} 个 API Key",
  enabledKeys: "{{count}} 个已启用",
  newApiKey: "新建 API Key",
  noApiKeys: "暂无 API Key",
  clickToCreate: "点击上方按钮创建新的 API Key",
  maskHint: "列表中只显示脱敏后的 Key，保留首尾字符：",
  name: "名称",
  apiKey: "API Key",
  status: "状态",
  usageCount: "使用次数",
  createdAt: "创建时间",
  operations: "操作",
  "delete": "删除",
  createApiKey: "新建 API Key",
  createApiKeyDesc: "创建一个新的 API Key 用于代理服务认证",
  keyName: "名称",
  keyNamePlaceholder: "例如：生产环境、测试环境",
  cancel: "取消",
  create: "创建",
  confirmDelete: "确认删除",
  confirmDeleteDesc: "删除后无法恢复，确定要删除这个 API Key 吗？",
  keyEnabled: "API Key 已启用",
  keyDisabled: "API Key 已禁用",
  authEnabled: "API Key 认证已启用",
  authDisabled: "API Key 认证已禁用",
  pleaseEnterName: "请输入名称",
  keyNameRequired: "API Key 名称不能为空",
  copied: "已复制",
  copiedToClipboard: "API Key 已复制到剪贴板",
  deleted: "已删除",
  keyDeleted: "API Key 已删除"
};
const logs$1 = {
  pageTitle: "请求日志",
  pageDescription: "查看经过代理服务的请求记录",
  timestamp: "时间",
  clearLogs: "清空",
  filter: "筛选",
  clearConfirm: "清空日志",
  clearConfirmDesc: "确定要清空所有日志吗？此操作不可撤销。",
  requestLogs: "请求日志",
  all: "全部",
  noRequestLogs: "暂无请求日志",
  noRequestLogsHint: "代理收到请求后，这里会列出每一次调用。",
  todayRequests: "今日请求",
  todaySuccess: "今日成功",
  todayErrors: "今日错误",
  provider: "供应商",
  account: "账户",
  userInput: "用户输入",
  requestBody: "请求体",
  duration: "耗时",
  latency: "延迟",
  method: "方法",
  url: "URL",
  stream: "流式",
  responseStatus: "响应状态",
  errorMessage: "错误信息",
  stackTrace: "堆栈跟踪",
  noRequestData: "暂无请求数据",
  bodiesNotRecorded: "未保存请求体与响应体",
  bodiesNotRecordedHint: "当前日志设置未开启正文记录。可在「设置 › 数据管理」中打开「保存请求体与响应体」，开启后的新请求才会在此显示内容。",
  noUserInput: "暂无用户输入",
  noError: "暂无错误",
  tabInfo: "信息",
  tabRequest: "请求",
  tabUserInput: "用户输入",
  tabError: "错误",
  tabResponse: "响应",
  responseBody: "响应内容",
  webSearch: "网络搜索",
  reasoningEffort: "深度思考",
  maxTokens: "输出上限",
  finishReason: "结束原因",
  contextFitFits: "装得下",
  contextFitOverflow: "装不下",
  contextFitUnknown: "窗口未公布",
  inputTokensEstimate: "估算入量 / 窗口",
  contextFit: "窗口装不装得下",
  contextFitMeasured: "上游实测",
  streamTruncated: "上游断流",
  truncatedShort: "断流",
  attempts: "尝试链",
  streamFirstToken: "首字耗时",
  streamEndReason: "流结束原因",
  streamBytes: "输出字节",
  streamPings: "心跳数",
  upstreamRequestId: "上游 Request ID",
  errorType: "错误类型",
  errorCode: "错误码",
  errorParam: "错误参数",
  upstreamStatus: "上游状态码",
  saveDiagnosticBundle: "导出诊断包"
};
const settings$1 = {
  title: "设置",
  description: "管理应用程序设置和偏好",
  appearance: "外观",
  theme: "主题",
  themeSettingsDesc: "自定义应用程序的外观主题",
  themeLight: "浅色",
  themeDark: "深色",
  language: "语言",
  languageSettingsDesc: "设置应用程序的显示语言",
  languageZh: "简体中文",
  languageEn: "English",
  sidebarCollapsed: "默认折叠侧边栏",
  sidebarCollapsedHelp: "启动时默认折叠侧边栏以获得更大的工作区域",
  behavior: "行为",
  general: "通用",
  dataSecurity: "数据与安全",
  expandSidebar: "展开侧边栏",
  collapseSidebar: "折叠侧边栏",
  autoStart: "开机自启",
  autoStartHelp: "系统启动时自动运行应用，登录后隐藏启动、不抢焦点（Linux 写入 ~/.config/autostart；开发模式下不生效，打包后可用）",
  autoStartProxy: "自动启动代理",
  autoStartProxyHelp: "应用启动时自动启动代理服务",
  minimizeToTray: "最小化到托盘",
  minimizeToTrayHelp: "关闭窗口时最小化到系统托盘",
  closeBehavior: "关闭行为",
  closeBehaviorDesc: "配置应用关闭时的行为",
  closeBehaviorMinimize: "最小化",
  closeBehaviorClose: "直接关闭",
  closeBehaviorAsk: "询问",
  enableNotifications: "启用通知",
  enableNotificationsHelp: "显示系统通知",
  oauthProxyMode: "OAuth 登录代理",
  oauthProxyModeHelp: "设置 OAuth 登录时的网络代理模式",
  oauthProxySystem: "系统代理",
  oauthProxyNone: "不使用代理",
  modelRefresh: {
    title: "模型清单定时刷新",
    enabled: "启用定时刷新",
    enabledHelp: "关闭后不会自动更新任何供应商的模型清单，只剩手动刷新",
    shortInterval: "账号渠道刷新周期",
    shortIntervalHelp: "账号渠道走本地 RPC，零网络成本；模型清单变化低频，默认 1 周",
    longInterval: "聚合/内置刷新周期",
    longIntervalHelp: "聚合目录与内置供应商是真·HTTP 打上游，宜稀疏，默认 2 周",
    accountChannels: "账号渠道",
    accountChannelsHelp: "13 个渠道，本地 model.list RPC 预热内存缓存（不写盘、不广播）",
    aggregate: "聚合目录",
    aggregateHelp: "遍历已配置的聚合条目，跑 syncModels 对齐上游模型清单",
    builtin: "内置供应商",
    builtinHelp: "有 modelsFetch 的内置供应商真·HTTP 重拉（当前为空集合）",
    triggerNow: "立即刷新一次",
    triggerNowHelp: "立刻跑一轮全部已启用类别的刷新",
    triggerBtn: "立即刷新",
    triggering: "刷新中…",
    triggerError: "刷新失败：{{reason}}",
    week1: "1 周",
    week2: "2 周",
    month1: "1 月",
    month3: "3 月",
    month6: "6 月"
  },
  logSettings: "日志设置",
  logLevel: "日志级别",
  logLevelHelp: "选择日志记录级别",
  selectLogLevel: "选择日志级别",
  logRetentionDays: "日志保留天数",
  logRetentionHelp: "超过此天数的日志将被自动清理",
  maxLogs: "最大日志数量",
  maxLogsHelp: "超过此数量时将清理最早的日志",
  requestLogEnabled: "持久化请求日志",
  requestLogEnabledHelp: "保存结构化请求日志，用于诊断和统计",
  requestLogMaxEntries: "请求日志上限",
  requestLogMaxEntriesHelp: "仅保留最新的持久化请求日志，设为 0 可禁用存储",
  requestLogIncludeBodies: "保存请求体与响应体",
  requestLogIncludeBodiesHelp: "在请求日志中记录请求体和响应体内容",
  requestLogMaxBodyChars: "请求体字符上限",
  requestLogMaxBodyCharsHelp: "每条请求体或响应体最多持久化的字符数",
  requestLogRedactSensitive: "敏感信息脱敏",
  requestLogRedactSensitiveHelp: "在持久化前隐藏 token、cookie、API key 等敏感字段",
  dataManagement: "界面偏好同步",
  dataManagementDesc: "只同步主题、语言、日志级别等界面偏好，不含厂商、账号与凭据。需要完整迁移请用上方「完整备份与迁移」。",
  exportConfig: "导出界面偏好",
  importConfig: "导入界面偏好",
  exporting: "导出中...",
  importing: "导入中...",
  exportSuccess: "配置导出成功",
  exportFailed: "配置导出失败",
  importSuccess: "界面偏好已导入，重启后生效。厂商、账号与凭据不在这份导出文件里，请使用上方「完整备份与迁移」。",
  importFailed: "配置文件格式无效",
  backup: {
    title: "完整备份与迁移",
    description: "导出全部数据与配置，在另一台电脑导入即可完整迁移，包含账号凭据与渠道登录态",
    contains: "这份备份包含：",
    containsProviders: "供应商、聚合条目与自定义端点",
    containsAccounts: "账号凭据（API Key / Cookie / 刷新令牌）",
    containsConfig: "路由、模型别名、代理 API Key、管理密钥与模型标注",
    containsChannels: "渠道账号与登录态",
    "export": "导出完整备份",
    "import": "导入备份",
    reading: "读取中...",
    restartHint: "导入会覆盖或补齐本机数据，完成后需要重启应用才能生效。",
    exportTitle: "导出完整备份",
    exportDesc: "备份文件默认包含明文凭据，建议开启口令加密后再保存。",
    includeStatistics: "包含统计数据",
    includeStatisticsHelp: "请求计数、Token 账本等历史统计",
    includeLogs: "包含日志",
    includeLogsHelp: "请求日志与应用日志，体积较大，且含用户输入片段",
    encrypt: "用口令加密",
    encryptHelp: "scrypt + AES-256-GCM；换机器导入时用同一个口令解开",
    password: "口令",
    passwordConfirm: "确认口令",
    passwordPlaceholder: "至少 8 位",
    passwordHelp: "口令不会被保存。忘记口令则这份备份无法恢复。",
    plaintextWarning: "关闭加密后，备份文件里是明文的上游 API Key 与会话 Cookie。请只存放到可信位置，导入完成后删除。",
    passwordMismatch: "两次输入的口令不一致",
    exportConfirm: "选择位置并导出",
    exporting: "导出中...",
    exportSuccess: "备份已导出",
    exportSuccessDesc: "{{size}}，包含 {{providers}} 个供应商、{{accounts}} 个账号",
    unlockTitle: "输入备份口令",
    unlockDesc: "这份备份已用口令加密，输入导出时设置的口令。",
    unlock: "解锁",
    unlocking: "解锁中...",
    previewTitle: "确认导入内容",
    previewDesc: "以下数字来自备份文件本身，导入前请核对。",
    countProviders: "供应商",
    countAccounts: "账号",
    countWithCredentials: "{{n}} 个含凭据",
    countRoutes: "路由",
    countMappings: "模型别名",
    countApiKeys: "代理 API Key",
    countChannelAccounts: "渠道账号",
    countRequestLogs: "请求日志",
    countAppLogs: "应用日志",
    countCreatedAt: "导出时间",
    mode: "导入方式",
    modeReplace: "覆盖（推荐换机）",
    modeReplaceDesc: "本机数据整体替换为备份内容，等同把另一台电脑搬过来",
    modeMerge: "合并",
    modeMergeDesc: "只补本机没有的供应商、账号、路由与别名，本地配置保持不变",
    replaceWarning: "覆盖会先复制当前 data.json，然后删除本机现有的供应商、账号与凭据。",
    apply: "开始导入",
    applying: "导入中...",
    applySuccess: "导入完成",
    applySuccessDesc: "数据已写入，重启应用后生效。",
    skipped: "合并模式未导入：{{blocks}}（这些块只在覆盖模式下落库）",
    safetyCopy: "导入前的 data.json 副本：{{path}}",
    later: "稍后重启",
    restartNow: "立即重启",
    warnNoCredentials: "备份里的账号没有凭据，导入后需要重新登录或填写 Key",
    warnCredentialsUnreadable: "部分凭据在本机已无法解密，没能写进备份",
    warnChannelUnavailable: "渠道运行时不可用，渠道登录态没有包含在这份备份里",
    warnDifferentPlatform: "备份来自其他操作系统，路径与自启设置可能需要调整",
    warnNewerAppVersion: "备份由更新版本的应用导出，本版本可能读不全其中的字段",
    skipStatistics: "统计数据",
    skipLogs: "日志",
    skipChannels: "渠道登录态",
    error: {
      "not-json": "文件不是有效的 JSON",
      "not-object": "文件内容不是备份对象",
      "wrong-format": "不是 ModelPort 备份文件",
      "unsupported-version": "备份版本高于当前应用，请先升级",
      expired: "这次导入已超时，请重新选择文件",
      "storage-not-ready": "数据存储未就绪，请重启应用后重试",
      "read-failed": "读取文件失败（可能过大或没有权限）",
      "write-failed": "写入文件失败",
      "upload-unavailable": "这台网关没有上传导入接口（版本早于该功能）。升级网关，或把备份件放到那台机器上执行 node modelport-daemon.cjs --import-backup <路径>（口令走 stdin 或 MODELPORT_BACKUP_PASSWORD）。",
      "desktop-only-restart": "无头网关由 systemd 托管，页面不能替它重启：干净退出在 Restart=on-failure 下不会被拉起，等于把网关关掉。请在该宿主执行 systemctl restart modelport。",
      "restart-failed": "重启请求失败。",
      "desktop-only-export": "这个网关跑在没有窗口的宿主上（WSL / 无头守护进程），那里没有保存对话框，界面里导不出备份。请在桌面端导出，或直接备份该宿主的 data.json 目录。",
      "bad-password": "口令错误",
      "apply-failed": "导入失败，已保留导入前的 data.json 副本"
    }
  },
  clearCache: "清除缓存",
  clearing: "清除中...",
  cacheCleared: "缓存清除成功",
  cacheClearFailed: "缓存清除失败",
  dangerZone: "危险区域",
  dangerZoneDesc: "这些操作不可逆，请谨慎操作",
  resetApp: "重置应用",
  resetting: "重置中...",
  confirmReset: "确认重置",
  confirmResetDesc: "这将清除所有设置和数据，应用程序将恢复到初始状态。此操作无法撤销。",
  resetSuccess: "应用重置成功，正在重新加载...",
  resetFailed: "应用重置失败",
  appName: "ModelPort",
  currentVersion: "当前版本",
  checkUpdates: "检查更新",
  checking: "正在检查更新...",
  upToDate: "当前已是最新版本",
  updateCheckFailed: "无法连接到更新服务器",
  downloadUpdate: "下载更新",
  downloadingUpdate: "正在下载更新...",
  updateDownloaded: "更新已下载",
  restartAndInstall: "重启并安装",
  updateAvailable: "发现新版本",
  retry: "重试",
  managementApi: {
    title: "管理 API",
    description: "配置管理 API 以通过程序化方式访问平台设置",
    enableToggle: "启用管理 API",
    enableDescription: "启用后，可通过 REST API 端点进行配置",
    secretKey: "密钥",
    secretKeyDescription: "在 Authorization 头中使用此密钥作为 Bearer 令牌",
    secretKeyPlaceholder: "未生成密钥",
    copySecret: "复制",
    showSecret: "显示密钥",
    hideSecret: "隐藏密钥",
    generateNew: "生成新密钥",
    generateConfirm: "确定要生成新的密钥吗？当前密钥将失效。",
    status: "状态",
    enabled: "已启用",
    disabled: "已禁用",
    apiDocumentation: "API 文档",
    apiEndpoint: "API 端点",
    exampleUsage: "使用示例",
    warning: "请妥善保管您的密钥，不要与未授权方共享。"
  }
};
const common$1 = {
  save: "保存",
  cancel: "取消",
  "delete": "删除",
  edit: "编辑",
  add: "添加",
  close: "关闭",
  confirm: "确认",
  success: "成功",
  error: "错误",
  loading: "加载中...",
  noData: "暂无数据",
  refresh: "刷新",
  copy: "复制",
  copied: "已复制",
  yes: "是",
  no: "否",
  enabled: "已启用",
  disabled: "已禁用",
  actions: "操作",
  details: "详情",
  next: "下一步",
  previous: "上一步",
  reset: "重置"
};
const proxyStatus$1 = {
  start: "启动代理",
  stop: "停止代理"
};
const quickActions$1 = {
  title: "快捷操作",
  addAccount: "添加账户",
  viewLogs: "查看日志"
};
const oauth$1 = {
  validating: "验证中..."
};
const models$1 = {
  title: "模型管理",
  description: "逐个控制模型或别名进不进路由候选池；对外只广告路由",
  modelList: "模型列表",
  modelMapping: "模型映射",
  metadataTab: "标注覆盖",
  annotation: {
    title: "标注「{{model}}」",
    factsSection: "这一家已声明的参数（含出处）",
    catalogSection: "用第三方标准台账补全",
    markSection: "手工标注（优先级最高）",
    unavailable: "主进程未提供单模型元数据接口，请重启应用后再试。"
  },
  metadata: {
    batchScopeButton: "批量补全这一家",
    batchScopeTitle: "批量补全：{{scope}}",
    batchScopeDesc: "只处理这一家的模型，范围外的标注不受影响；标准库匹配不联网。",
    batchScopeNone: "本范围内没有可补全的模型：已停用，或未被任何启用的路由引用。",
    batchScopeProgressTitle: "这一家的补全进度",
    batchScopeDone: "这一家补全完成",
    batchScopeCancelled: "这一家补全已取消",
    batchScopeFailedStart: "这一家补全未能开始",
    title: "模型元数据标注",
    coverageTitle: "标注覆盖率",
    coverageDesc: "每项属性已知行数占适用行数的比例（聚合与自定义行的倍率不适用，不计入缺口）；解析顺序：人工 > 上游声明 > 标准库 > 实测探测 > 家族规则 > 成本账本",
    loading: "正在汇总元数据…",
    retry: "重试",
    refresh: "刷新",
    unavailable: "当前环境不支持元数据报表",
    totalModels: "目录模型",
    routingComplete: "关键属性完整",
    routingIncomplete: "关键属性待补",
    gapKindAdoptable: "可补齐 {{count}}",
    gapKindMissingField: "条目缺该项 {{count}}",
    gapKindNoCandidate: "标准库无此模型 {{count}}",
    gapKindNotChat: "非对话模型 {{count}}",
    gapKindNotChatBadge: "非对话模型",
    gapKindNoCandidateBadge: "标准库无此模型",
    fullyAnnotatedHint: "适用项全齐 {{count}}",
    referenceAttribute: "参考",
    notApplicable: "不适用 {{count}}",
    referenceOnlyBadge: "仅剩参考项",
    queueTitle: "待标注队列",
    queueDesc: "按调用量从高到低排列；没有来源的属性一律显示「未标注」，不猜测",
    emptyQueue: "所有模型的关键属性都已有来源",
    queueTruncated: "仅显示调用量最高的 {{shown}} 个，共 {{total}} 个待标注",
    columnModel: "模型",
    columnContext: "上下文窗口",
    columnMaxOutput: "输出上限",
    columnMissing: "缺失属性",
    columnCalls: "调用量",
    columnActions: "操作",
    probe: "探测",
    probing: "探测中…",
    probeSuccess: "探测完成",
    probeFailed: "探测失败",
    unclassified: "未标注",
    attrModelType: "模型类型",
    attrVision: "视觉输入",
    attrTools: "工具调用",
    attrReasoning: "推理",
    attrModalities: "输入模态",
    attrContextTokens: "上下文窗口",
    attrMaxOutputTokens: "输出上限",
    attrWeight: "消耗权重",
    attrFree: "免费",
    sourceManual: "人工标注",
    sourceUpstream: "上游声明",
    sourceCatalog: "标准库",
    sourceFamilyRule: "家族规则",
    sourceProbe: "实测探测",
    sourceCostLedger: "成本账本",
    sourceUnclassified: "未标注",
    confidenceDeclared: "声明级",
    confidenceInferred: "推定",
    confidenceMeasured: "实测",
    probeDialogTitle: "探测 {{model}}",
    probeDialogDesc: "探测只在确认后发出；同一模型串行，跨模型并发上限 1。",
    probeContextScope: "上下文窗口",
    probeOutputScope: "输出上限",
    probeCapabilityScope: "能力（工具 / 图片）",
    probeEstimate: "上限 {{requests}} 条请求 · 约 {{tokens}} tokens",
    probeEstimateSplit: "输入约 {{input}} · 输出约 {{output}} tokens",
    probeDeclared: "已声明，无需探测",
    probeDeclaredSource: "来源：{{source}}（声明级）",
    forceProbe: "强制重测",
    forceProbeHint: "重测只新增实测证据，人工标注仍是最高优先级",
    probeCancel: "取消",
    probeClose: "关闭",
    probeStop: "取消探测",
    probeRetry: "重试",
    probeCancelled: "探测已取消，已完成档位的结论已保留",
    probeElapsed: "已用 {{seconds}}s",
    probeRequestsSent: "请求 {{sent}}/{{limit}}",
    probePhasePrepare: "准备中",
    probePhaseTier: "第 {{index}}/{{count}} 档 · {{tokens}} tokens",
    probePhaseAwaiting: "等待响应（第 {{index}}/{{count}} 档）",
    probePhaseDone: "已完成",
    probePhaseCancelled: "已取消",
    probeErrorNetwork: "网络不可达（检查代理/网络后重试）",
    probeErrorAuth: "鉴权失败（检查账户密钥或权限）",
    probeErrorRateLimit: "被限流（稍后重试或换账户）",
    probeErrorTimeout: "上游超时（按无结论收敛，可重试）",
    probeErrorUpstream: "上游错误（服务端 5xx，可重试）",
    probeErrorUnknown: "探测失败（可重试）",
    batchAll: "全部补齐",
    batchViewProgress: "查看进度",
    batchProbeToggle: "同时执行探测",
    batchProbeToggleHint: "默认关闭；开启后只确认一次总预估",
    batchProgressTitle: "全部补齐进度",
    batchPhase_prepare: "准备中",
    batchPhase_matching: "匹配标准库",
    batchPhase_probing: "探测中",
    batchPhase_backoff: "限流退避",
    batchPhase_done: "已结束",
    batchProcessed: "已处理 {{done}}/{{total}}（{{percent}}%）",
    batchCurrentModel: "当前模型",
    batchElapsed: "已用 {{time}}",
    batchEta: "预计剩余 {{time}}",
    batchSuccess: "成功",
    batchSkippedCount: "跳过",
    batchFailedCount: "失败",
    batchAdopted: "已采用 {{fields}} 个字段 · 精确 {{exact}} 个模型 · 别名 {{alias}} 个模型",
    batchAliasAdopted: "别名匹配已采用：{{models}}",
    batchFamilyCandidates: "家族候选 {{count}} 个（不自动采用，仅供查看）",
    batchProbeUsage: "探测请求 {{sent}}/{{limit}}",
    batchMeasuredFields: "已实测字段 {{count}} 个",
    batchSkippedDisabled: "已停用 / 未被路由引用，跳过 {{count}} 个",
    batchBackoff: "遇到限流，退避 {{seconds}} 秒后继续",
    batchFailedList: "失败模型",
    batchPause: "暂停",
    batchResume: "继续",
    batchCancelRun: "取消",
    batchRetryFailed: "仅重试失败项",
    batchConfirmTitle: "开启探测：确认本次总量",
    batchConfirmDesc: "标准库补全本身不联网；探测会按账户真实发送请求。确认后全程不再询问。",
    batchConfirmOnce: "只确认这一次；之后自动分批执行直到完成。",
    batchConfirmCancel: "先不探测",
    batchConfirmStart: "开始",
    batchModels: "{{selected}} 个模型",
    batchFields: "{{count}} 个字段",
    batchMatchBreakdown: "精确 {{exact}} · 别名 {{alias}} · 家族候选 {{family}}",
    batchProbeModels: "{{count}} 个模型需要探测",
    batchDone: "全部补齐完成",
    batchCancelled: "全部补齐已取消",
    batchFailed: "全部补齐未能开始",
    batchNoTargets: "没有需要补齐的模型",
    batchSummary: "成功 {{success}} · 跳过 {{skipped}} · 失败 {{failed}}",
    batchStatus_matching: "匹配中",
    batchStatus_probing: "探测中",
    batchStatus_done: "已完成",
    batchStatus_partial: "部分成功",
    batchStatus_skipped: "跳过",
    batchStatus_failed: "失败",
    batchPausedLabel: "已暂停",
    catalogSourceError: "该来源失败：{{error}}（其它来源与上一份快照不受影响）",
    catalogBuiltinBadge: "内置快照（{{date}}）",
    catalogBuiltinFetchedAt: "内置快照日期：{{date}}",
    catalogUsingBuiltin: "正在使用内置快照（{{date}}）",
    catalogEndpointAttempts: "端点尝试",
    catalogEndpoint_primary: "主端点",
    catalogEndpoint_jsdelivr: "jsDelivr",
    catalogEndpoint_mirror: "自定义镜像",
    catalogEndpointFailed: "失败",
    catalogErrorKind_network: "网络不可达",
    catalogErrorKind_timeout: "超时",
    catalogErrorKind_http: "HTTP 错误",
    catalogErrorKind_parse: "解析失败",
    catalogErrorKind_empty: "无可用条目",
    catalogErrorKind_unknown: "未知错误",
    catalogMirrorSave: "保存镜像",
    catalogMirrorSaved: "镜像地址已保存",
    catalogMirrorInvalid: "镜像地址无效（仅支持 https）",
    catalogMirrorHint: "可选，仅支持 https；可达性与可信度由你自行判断，留空则不使用。",
    probeStatusMeasured: "已测出区间",
    probeStatusInconclusive: "无结论（上游未给出可判定的失败）",
    probeStatusSuspect: "疑似静默截断",
    probeStatusDeferred: "暂缓（本地并发或额度不足）",
    probeStatusSkipped: "已声明，跳过",
    probeRangeLabel: "实测区间：{{range}}",
    probeReasonLabel: "原因：{{reason}}",
    probeRequests: "{{count}} 条请求",
    probeTokens: "约 {{tokens}} tokens",
    probeNoPlan: "没有可探测的档位",
    catalogTitle: "标准模型库快照",
    catalogDesc: "第三方台账只在本地留快照；打开页面不联网，刷新必须由你点击。刷新失败会保留上一份快照。",
    catalogReady: "已存 {{count}} 条",
    catalogNotFetched: "尚未抓取",
    catalogRefresh: "刷新快照",
    catalogRefreshing: "刷新中…",
    catalogFetchedAt: "抓取时间：{{time}}",
    catalogLicense: "许可：{{license}}",
    catalogAttribution: "归属：{{attribution}}",
    catalogHash: "内容指纹：{{hash}}",
    catalogLicenseNotice: "标准库是第三方数据，仅作参考；价格按 USD / 1M tokens 展示，不参与路由、额度或权重计算，也不并入本项目的生成式价格旁表。",
    annotate: "标注",
    catalogDialogTitle: "从标准库补全 {{model}}",
    catalogDialogDesc: "候选按「精确 id → 归一化别名 → 家族」排序，默认不采用；每个字段单独采用，可随时撤销。",
    catalogLoading: "正在匹配标准库…",
    catalogFailed: "标准库操作失败",
    catalogNoMatches: "当前快照里没有匹配的条目；可以先刷新快照，或该模型确实不在标准台账中。",
    catalogFieldAbsent: "该台账条目没有这一项，无法采用。",
    catalogSourcesNotFetched: "未抓取：{{sources}}。内置 LiteLLM 台账没有「推理」这一项，「输入模态」也只覆盖部分条目；要补这两项，请先到「标准模型库」卡片刷新这些来源，或改用手工标注 / 探测。",
    catalogConfidenceExact: "精确 id",
    catalogConfidenceAlias: "别名归一",
    catalogConfidenceFamily: "家族启发",
    catalogConfidenceFuzzy: "模糊匹配",
    catalogFieldPrice: "价格（参考）",
    catalogPriceHint: "仅展示，不参与路由/额度",
    catalogYes: "支持",
    catalogNo: "不支持",
    catalogAdopt: "采用",
    catalogAdopted: "已采用",
    catalogAdoptedBadge: "已采用",
    catalogAdoptedTitle: "已采用的字段",
    catalogAdoptedOther: "当前采用的是 {{id}}",
    catalogRevoke: "撤销",
    catalogRevokeAll: "全部撤销",
    catalogRevoked: "已撤销，回到自动解析结果",
    catalogRefreshDone: "标准库快照已更新",
    catalogRefreshFailed: "标准库刷新失败",
    catalogKeptOld: "已保留上一份快照"
  },
  modelName: "模型名称",
  provider: "供应商",
  account: "账户",
  status: "状态",
  available: "可用",
  unavailable: "不可用",
  searchModels: "搜索模型...",
  allProviders: "全部供应商",
  allTypes: "全部类型",
  typeMultimodal: "多模态",
  typeText: "纯文本",
  typeUnknown: "未知（上游未声明）",
  allCosts: "全部费用",
  allServeStates: "全部状态",
  servedOnly: "已启用",
  stoppedOnly: "未启用",
  costFreeOnly: "免费",
  costBelowBase: "低于基准（<1×）",
  costBase: "等于基准（1×）",
  costAboveBase: "高于基准（>1×）",
  costUnknown: "未标注倍率",
  free: "免费",
  multimodal: "多模态",
  modalityHint: "模态取自渠道目录/适配器声明；未声明的模型记为未知，不做推断",
  costHint: "按消耗倍率分档，基准 1 倍取自渠道目录的展示名；渠道未报倍率且非免费的模型自成一档，不并入任何付费档",
  providerCredits: "供应商余额",
  weightUnknownHint: "渠道未报该模型的倍率，无法按消耗分档",
  stopped: "未启用",
  serveToggle: "是否让该模型进入路由候选池",
  serveOnlySelected: "仅启用选中",
  serveOnlyDone: "候选池范围已更新",
  serveOnlyDoneDesc: "保留 {{count}} 个模型进路由池，其余已移出",
  serveChangeFailed: "停用/启用失败",
  servedOfTotal: "{{served}}/{{total}} 个模型在路由池里",
  selectAll: "全选",
  copySelected: "复制选中",
  copyAll: "复制全部",
  totalModels: "共 {{count}} 个模型",
  selectedModels: "已选择 {{count}} 个模型",
  noModelsFound: "未找到模型",
  noModelsDesc: "请先添加供应商和账户",
  noMatchDesc: "当前筛选条件下没有模型，试试放宽类型或费用筛选",
  copySuccess: "复制成功",
  copySuccessDesc: "已复制 {{count}} 个模型名称到剪贴板",
  pageInfo: "第 {{current}} / {{total}} 页"
};
const modelEditor$1 = {
  title: "模型管理 - {{name}}",
  defaultModels: "默认模型",
  customModels: "自定义模型",
  displayName: "显示名称",
  fromOnlineSync: "在线同步",
  actualModelId: "实际调用ID",
  actions: "操作",
  addModel: "添加模型",
  resetDefault: "恢复默认",
  cancel: "取消",
  noModels: "暂无模型",
  warningMessage: "实际调用模型ID需自行在供应商官方页面获取，填写错误将导致对话失败。建议先在官方页面确认模型ID后再添加。",
  addDialogTitle: "添加自定义模型",
  displayNameLabel: "模型显示名称",
  displayNamePlaceholder: "例如: My-Custom-Model",
  displayNameHelp: "AI客户端调用时使用的模型名称",
  actualIdLabel: "实际调用模型ID",
  actualIdPlaceholder: "例如: deepseek-chat",
  actualIdHelp: "API接口真正使用的模型标识",
  add: "添加",
  nameRequired: "模型显示名称不能为空",
  idRequired: "实际调用模型ID不能为空",
  nameExists: "模型显示名称已存在",
  addSuccess: "模型添加成功",
  addError: "模型添加失败",
  removeSuccess: "模型删除成功",
  removeError: "模型删除失败",
  resetSuccess: "已恢复默认模型",
  resetError: "恢复默认失败",
  confirmReset: "确定要恢复默认模型吗？这将删除所有自定义模型和排除设置。",
  confirmDelete: "确定要删除此模型吗？"
};
const about$1 = {
  tagline: "多平台 AI 服务统一管理工具",
  links: "链接",
  github: "GitHub 仓库",
  releases: "版本发布",
  reportIssue: "报告问题",
  appUpdates: "应用更新",
  shellUpdateTitle: "在线升级（Shell + 网关）",
  shellUpdateDesc: "Shell 负责升级自己，并在网关标记为 WSL 托管时一并升级 WSL 里的 daemon。安装包会先校验 SHA-256。",
  gatewayRemoteTitle: "网关更新",
  gatewayRemoteDesc: "此界面由远程网关托管，没有本地 Shell 升级器。网关升级请下载 tarball 在宿主机执行；Shell 请重新安装对应安装包。",
  shellVersion: "Shell 版本",
  gatewayVersion: "网关版本",
  gatewayUnmanaged: "此网关未标记为 WSL 托管，只能升级 Shell；远程网关请在宿主机手动升级。",
  daemonReadFailed: "读取网关版本失败",
  updateAvailable: "有可用更新",
  missingAssets: "缺少安装资源或校验文件",
  upgradeAll: "升级",
  upgradeDone: "升级完成",
  upgradeFailed: "升级失败",
  openReleasePage: "打开发布页",
  stages: {
    checking: "检查更新",
    "downloading-daemon": "下载 daemon",
    "verifying-daemon": "校验 daemon",
    "installing-daemon": "安装 daemon",
    "restarting-daemon": "重启网关",
    "downloading-shell": "下载 Shell",
    "verifying-shell": "校验 Shell",
    "installing-shell": "安装 Shell",
    done: "完成",
    error: "失败"
  },
  credits: "由开源社区 ❤️ 制作",
  builtWith: "基于 Electron、React、TypeScript、Tailwind CSS、Zustand、Koa 等优秀的开源项目构建。"
};
const session$1 = {
  sessionSettings: "会话设置",
  deleteAfterChat: "对话记录清理",
  deleteAfterChatHint: "每次对话结束后自动删除Web端对话记录",
  configSaved: "会话配置已保存",
  configSaveFailed: "保存会话配置失败"
};
const compression$1 = {
  title: "上下文压缩",
  loading: "正在读取当前设置…（读到之前不显示开关，避免把默认值当成现状保存）",
  enable: "启用上下文压缩",
  enableHint: "只压缩最新一轮的工具输出与用户输入（live zone），历史字节不动，因此不会打掉上游前缀缓存。关闭时请求逐字节不变。",
  aggressiveness: "压缩力度",
  aggressivenessHint: "力度越高保留的行越少。错误行、统计离群行与数值异常行在任何力度下都不会被丢弃。",
  cacheFirst: "缓存优先（对支持前缀缓存的供应商跳过压缩）",
  cacheFirstHint: "压缩后的最新块会被下一轮的原文覆盖，所以在上游缓存读远便宜于新输入的家（DeepSeek、Anthropic）上，压缩往往省得没有丢掉的缓存折扣多。开启后这些家默认不压缩，除非按供应商显式覆盖。",
  level: {
    conservative: "保守",
    moderate: "中等",
    aggressive: "激进"
  },
  configSaved: "压缩配置已保存",
  configSaveFailed: "保存压缩配置失败"
};
const promptCaching$1 = {
  title: "提示缓存",
  loading: "正在读取当前设置…",
  enable: "为 Anthropic 请求放置缓存断点",
  enableHint: "给 Anthropic 格式的请求加 cache_control 标记（工具表末尾、system 末尾、上一轮末尾）。只加元数据，不改任何文本。DeepSeek 等自动前缀缓存的供应商不需要断点，也不受这个开关影响。",
  ttl: "缓存存活时长",
  ttlHint: "5 分钟是默认档。1 小时的写入更贵、但能跨过更长的空档；只发给支持显式断点的端点。",
  ttlOption: {
    "5m": "5 分钟",
    "1h": "1 小时"
  },
  note: "只作用于 Anthropic 格式端点。DeepSeek 等 implicit-prefix 供应商由上游自动缓存，命中率取决于前缀稳定与账号/模型亲和，不由这个开关控制。",
  configSaved: "提示缓存配置已保存",
  configSaveFailed: "保存提示缓存配置失败"
};
const anthropicInbound$1 = {
  title: "Anthropic 客户端（Claude Desktop / Claude Code）",
  loading: "读取中…",
  documentPassThrough: "把附件真的发给上游",
  documentPassThroughHint: "Anthropic 的 `document` 块翻成 OpenAI 兼容的 `file` 块，真的进上游报文。开着（默认）意味着吃不下文件的模型会明确报错，而不是装作附件不存在照样答一句；另外附件在契约层算视觉需求，所以这类请求只会落到标了 vision 的候选上。关掉则丢掉这一格，但会写进 X-ModelPort-Anthropic-Dropped 并记一条 warn。这一格的消费方是 proxy/routes/messages.ts。",
  defaultModel: "兜底模型",
  defaultModelHint: "客户端发来的模型名在网关里解析不出来时落到哪一条。留空即走网关默认：`auto` 路由；没有 `auto` 时取第一条启用中的路由。",
  mappings: "模型名映射",
  mappingsHint: "客户端发来的名字（完整名或前缀）→ 网关模型名。精确键优先于前缀键。",
  noMappings: "尚无映射：网关不认识的名字会落到上面的兜底模型。",
  clientName: "客户端发来的名字",
  gatewayModel: "网关模型",
  addMapping: "添加映射",
  remove: "删除映射",
  discoveryTitle: "Anthropic 客户端能发现的名字",
  discoveryHint: "Claude Desktop / Claude Code 读 /v1/models 时只保留以 claude 或 anthropic 开头的模型 id，所以以 <条目>/<模型> 形态出现的真 Claude 模型会在客户端那一侧消失。/v1/models 现在只广告路由，所以这里为每个这样的模型建一条路由：名字取自网关数据里本来就有的 Anthropic id，候选池钉死在真正服务它的那几家 —— 既不凭空造名，也不留一条可以随便拿别的模型应答的路由。这一节只服务目录里真的存在 Claude 形态模型的安装；没有那种模型时这一节不会出现，走上面的档位那一节。",
  discoveryPreview: "预览",
  discoveryApply: "生成路由",
  discoveryError: "生成失败：{{message}}",
  discoveryCreate: "将新增 {{total}} 条路由：",
  discoveryAlready: "{{total}} 个名字本来就能被发现：",
  discoverySkipped: "{{total}} 个名字被跳过，逐条给原因：",
  discoveryApplied: "已新增 {{total}} 条路由",
  discoveryFailed: "{{total}} 条路由建失败（已建成的保留不动）：",
  discoveryNothingNew: "没有可新增的：能被发现的名字都已有路由。",
  discoveryAlsoServedBy: "池内还含：{{names}}",
  discoveryReason: {
    "no-active-account": "这家没有可用账号，生成了也是必死的名字",
    "already-visible": "目录里已有同名模型",
    "mapping-exists": "这个名字被别名占用，路由不许与别名同名",
    "route-name-taken": "已有同名路由",
    "name-not-routable": "这个 Anthropic id 含点号或斜杠，路由名收不下（名字要进 X-ModelPort-Route-Name 响应头）—— 改用模型映射把它指到一条路由上"
  },
  duplicateNames: "客户端名重复：{{names}} —— 只有最后一行生效。",
  discoveryNote: "左边填完整模型名的条目会同时出现在 /v1/models 里，客户端才能从自己的列表选中它；只写前缀（例如 `claude-`）的键仅参与匹配，不会出现在那份清单里 —— 客户端会拿 Anthropic 自己的模型名表逐行筛掉它。",
  tierTitle: "按档位广告给客户端",
  tierHint: "Claude Desktop 保留清单里一行的条件是：名字是它认识的 Anthropic 模型名，或者这一行带合法档位。所以给一条现有路由标上档位就能把它广告出去，不必伪造 Anthropic 名字；客户端选中后发回来的就是这条路由名，直接落进它自己的池。这一格只管「发现」：客户端的模型下拉还会按名字再筛一次，档位在那一关不作数，所以下面会把选不中的名字点名出来。",
  tierNoRoutes: "没有启用中的路由：先去路由页启用一条。",
  tierColumn: "档位",
  routeColumn: "路由名（客户端筛的就是这个）",
  surfaceLead: "这张卡里两张表各管一件事：「客户端名 → 网关路由」定 Claude 里出现哪些名字、每个名字跑哪条路由；「按档位广告给客户端」定每条路由算 Anthropic 的哪一档，并在最后一列直接给结论。客户端只认名字 —— 名字不像 Anthropic 模型的路由，标了档位也只是「能被发现、点不到」。",
  outcomeColumn: "在 Claude 里的结果",
  outcomeSelectable: "会出现，可选中：{{name}}",
  outcomeNeedsName: "会被发现，但现在点不到 —— 保存时自动把名字改成 {{name}}",
  outcomeNotAdvertised: "不会出现在 Claude 里：既没标档位，名字 {{name}} 也不像 Anthropic 模型",
  tierNone: "不广告",
  tier_sonnet: "sonnet（日常高效）",
  tier_opus: "opus（强能力）",
  tier_haiku: "haiku（最快）",
  tier_fable: "fable（最难任务）",
  tier_mythos: "mythos",
  pickerGapAuto: "保存时会自动往上面的映射表里补：{{pairs}}（名字取 claude-档位，不带版本号，不冒充某个具体的 Anthropic 发布版本；补完想改想删都在那张表里）",
  pickerGapBlocked: "这几条补不出不冲突的名字：{{names}} —— 只能自己改路由名",
  pickerGapFix: "自动补的名字不满意就直接改路由名（例如 claude-daily），改完每行最后一列的结论会跟着变。",
  configSaved: "Anthropic 入向配置已保存",
  configSaveFailed: "保存 Anthropic 入向配置失败"
};
const contextManagement$1 = {
  title: "上下文管理",
  enableContextManagement: "启用上下文管理",
  enableContextManagementHint: "自动管理对话上下文，防止超出模型限制",
  strategyConfig: "策略配置",
  configSaved: "上下文管理配置已保存",
  configSaveFailed: "保存上下文管理配置失败",
  slidingWindow: {
    title: "上下文数",
    description: "保留最近 N 条消息，始终保留系统消息",
    maxMessages: "最大消息数",
    maxMessagesHint: "保留的最大消息数量（1-100）"
  },
  tokenLimit: {
    title: "最大Token数",
    description: "按 Token 数量截断历史，始终保留系统消息",
    maxTokens: "最大 Token 数",
    maxTokensHint: "保留的最大 Token 数量（100-100000）"
  }
};
const aggregate$1 = {
  title: "聚合渠道",
  description: "标准 Key 端点与免密免费池。添加后即成为一个供应商；模型以 供应商/模型 的名字对外暴露。",
  allCategories: "全部类别",
  category: {
    apikey: "自带 Key",
    freeTier: "免费池",
    local: "本地"
  },
  columnQuota: "免费额度",
  quotaFreePool: "免费池",
  quotaUsage: "{{metric}} 已用 {{used}}/{{limit}}（{{window}}）",
  quotaScopeNote: "官方口径：",
  window: {
    minute: "按本应用最近 1 分钟",
    day: "按本应用滚动 24 小时",
    month: "按本应用 UTC 自然月"
  },
  quotaSource: "额度出处（核对于 {{date}}）",
  quotaContext: "上下文 {{tokens}}",
  quota: {
    "needs-key": "未配 Key，无法计量",
    exhausted: "本应用已用到文档上限",
    documented: "有官方上限",
    undocumented: "官方未公布额度",
    absent: "额度未录入"
  },
  metric: {
    rpm: "次/分",
    rpd: "次/日",
    tpm: "token/分",
    tpd: "token/日",
    monthlyTokens: "token/月"
  },
  notConfigured: "未添加",
  active: "已启用",
  disabled: "已停用",
  unsupported: "暂不支持该认证",
  termsWarningAll: "条款：该端点属订阅套餐，仅限官方指定工具内交互使用；本应用发起的调用属套餐范围外使用",
  termsWarningFreeOnly: "条款：免费档模型仅限 OpenCode 客户端内使用；付费模型与 OpenCode Go 可用于第三方客户端",
  termsWarningSource: "条款原文（核对于 {{date}}）",
  deleteConfirm: "移除 {{name}} 及其账号？",
  dialog: {
    apiKeys: "API Key（可多把）",
    apiKeyPlaceholder: "每行粘贴一把 API Key",
    apiKeysHint: "每行一把；配多把后，调用这家供应商的模型会自动在 Key 之间轮询，某把被限流时自动换下一把。",
    baseUrl: "Base URL",
    baseUrlHint: "目录里没有可用默认地址时必须填写（占位符不会自动展开）。",
    models: "模型清单",
    paramsEdit: "参数",
    paramsApply: "应用",
    paramsClear: "清除",
    paramsExtra: "其他参数（JSON）",
    paramsInvalid: "参数格式有误：数值字段必须是数字，其他参数必须是 JSON 对象",
    enabled: "启用"
  },
  result: {
    saved: "已保存 {{name}}",
    removed: "已移除 {{name}}"
  },
  reasons: {
    unknown: "未知错误",
    unknown_entry: "目录中没有这家供应商",
    unsupported_auth: "该端点需要本应用无法提供的认证",
    missing_base_url: "必须填写 Base URL",
    placeholder_base_url: "Base URL 仍包含占位符",
    invalid_base_url: "Base URL 必须以 http:// 或 https:// 开头",
    missing_api_key: "必须填写 API Key",
    invalid_api_key: "所有已存 Key 都被端点拒绝",
    not_configured: "请先添加该供应商",
    no_model_list: "该端点不提供模型清单",
    http_status: "端点拒绝了请求",
    empty: "端点没有返回任何模型",
    unrecognized_shape: "无法识别模型清单格式",
    network_error: "网络错误",
    save_failed: "无法保存发现的模型",
    unknown_account: "账号不存在",
    unknown_model: "目录中没有该模型",
    missing_model: "必须填写模型 id",
    last_model: "至少要保留一个模型",
    keyless_entry: "该端点无需 Key"
  },
  manage: {
    search: "搜索供应商",
    sectionEnabled: "已启用",
    sectionDisabled: "已停用",
    sectionAvailable: "未添加",
    modelCount: "{{count}} 个模型",
    keyCount: "{{count}} 把 Key",
    noMatch: "没有匹配的供应商",
    wireChat: "OpenAI 兼容",
    wireAnthropic: "Anthropic 兼容",
    remove: "移除供应商",
    notConfiguredHint: "这家还没有加入聚合渠道。填好地址与 Key 后保存，它的模型就会以 供应商/模型 的名字对外暴露。",
    setup: {
      title: "添加到聚合渠道",
      modelsHint: "每行一个上游模型 id，留空使用目录清单。",
      submit: "保存并添加"
    },
    keys: {
      title: "API Key",
      keyless: "该端点无需 Key，保存后即可直接使用。",
      empty: "尚未添加 Key",
      placeholder: "粘贴 API Key 后回车",
      add: "添加",
      hint: "添加时会先用这把 Key 探测一次模型清单；通不过的 Key 不会保存。配多把后请求会在它们之间轮询。",
      added: "已添加 Key",
      rejected: "Key 未通过校验：{{message}}",
      validate: "复查",
      valid: "Key 可用",
      "delete": "删除",
      statusError: "校验失败",
      lastUsed: "最近使用 {{time}}"
    },
    endpoint: {
      title: "接口地址",
      chatPath: "调用路径",
      save: "保存地址",
      reset: "恢复默认",
      saved: "地址已保存",
      invalid: "地址必须以 http:// 或 https:// 开头"
    },
    quota: {
      title: "免费额度",
      none: "官方未公布额度，按实际调用计量。",
      notKeyed: "未配 Key，无法计量。"
    },
    credit: {
      title: "实时余额（向上游问的，不是本应用计量）",
      query: "查询实时额度",
      querying: "查询中…",
      needsKey: "该条目没有已存的 Key，没有可用来查询的凭据。",
      hint: "点一次只发一次 GET {{path}}；不做周期轮询，打开页面也不会自己发。",
      never: "这一家还没查询过。",
      unlimited: "这把 Key 报告没有花费上限 —— 既不是 0，也不当作“还剩很多”。",
      remaining: "剩余 {{remaining}} {{unit}}",
      remainingWithLimit: "剩余 {{remaining}} / 上限 {{limit}} {{unit}}",
      limitOnly: "只有上限 {{limit}} {{unit}}，上游没报余额",
      at: "读数时间 {{time}}",
      orderingOn: "读数新鲜（{{minutes}} 分钟内），参与选号排序。",
      orderingOff: "已过期（超过 {{minutes}} 分钟）：照实展示，不再参与排序，点一次可刷新。",
      perKey: "{{name}} · {{maskedKey}}",
      skippedKeys: "其余 {{n}} 把未查询",
      endpoint: "额度端点：{{path}}（出处：{{doc}}）",
      lastFail: "上一次查询（{{time}}）没问到余额：{{detail}}",
      failHttpStatus: "上游拒绝了这次查询",
      failNotJson: "额度接口没有按 JSON 回答",
      failShape: "报文形状不认识 —— 没有猜字段",
      failNetwork: "查询时网络出错",
      failDetail: "{{label}}：{{detail}}",
      failure: {
        unknown_entry: "目录里没有这个条目。",
        no_probe: "该条目没有声明额度端点，什么都没问。",
        not_configured: "供应商记录不存在，没有可查询的地址。",
        missing_api_key: "没有可用来查询的已存 Key。"
      },
      reason: {
        "http-status": "上游状态码",
        "not-json": "不是 JSON",
        "unexpected-shape": "形状不认识",
        network: "网络错误"
      }
    },
    models: {
      annotate: "标注",
      annotateHint: "查看这一家声明的参数，并用第三方标准台账逐字段补全",
      title: "模型",
      count: "{{total}} 个模型 · {{served}} 个启用",
      search: "搜索模型",
      empty: "暂无模型，点「添加模型」或「同步模型」。",
      sync: "同步模型",
      syncHint: "拉取上游 /models，把新模型并入清单（只增不减）",
      add: "添加模型",
      test: "测试该模型",
      testAll: "测试全部",
      testing: "测试中…",
      "delete": "删除该模型",
      expand: "展开",
      collapse: "收起",
      expandAll: "展开全部",
      collapseAll: "收起全部",
      testOk: "{{latency}} ms",
      testFailed: "失败",
      sourceBuiltin: "目录",
      sourceFetched: "同步",
      sourceCustom: "手动",
      groupToggle: "启用/停用整组",
      costTitle: "消耗",
      costFree: "免费",
      costIncluded: "套餐内",
      costPriced: "按量",
      costUnknown: "未标注",
      costFreeOfficial: "免费（官方公布）",
      costFreeCatalogue: "免费（目录标称）",
      costFreeThirdParty: "免费（第三方标价）",
      costFreeOfficialHint: "厂商自己的文档点名该模型免费",
      costFreeCatalogueHint: "目录转抄自上游注册表的免费清单，没有单独的官方出处",
      costFreeThirdPartyHint: "第三方目录（models.dev）标价为零，厂商未点名免费",
      costIncludedHint: "额度已含在订阅套餐里，边际价为 0；用完套餐额度就停，不是免费无限用",
      costPricedHint: "第三方目录给出的按量单价（USD / 百万 tokens）。这是绝对标价，不是消耗倍率",
      costUnknownHint: "没有免费标记，也没有可核对的标价：既不能当免费，也不能当付费",
      costSource: "出处：{{source}}（{{asOf}}）",
      costFilter: "消耗",
      costFilterAll: "全部消耗",
      costSummary: "{{free}} 免费 · {{included}} 套餐内 · {{priced}} 按量 · {{unknown}} 未标注",
      costPriceLabel: "{{input}} / {{output}} USD 每百万 tokens（输入 / 输出）"
    },
    modelAdd: {
      title: "添加模型",
      id: "上游模型 id",
      placeholder: "例如 gpt-4o-mini",
      hint: "填上游真实模型 id；保存后以 {{prefix}}/<id> 的名字对外暴露。",
      submit: "添加"
    },
    modelParams: {
      title: "模型参数 · {{model}}",
      hint: "配置值会覆盖客户端请求里的同名字段（model / messages / stream 不可覆盖）。"
    },
    toast: {
      saved: "已保存",
      removed: "已删除",
      modelRemoved: "已删除模型 {{model}}",
      tested: "测试完成：{{ok}} 个可用，{{failed}} 个失败",
      testing: "正在测试 {{count}} 个模型…",
      synced: "同步完成：上游 {{fetched}} 个，新增 {{added}} 个，现有 {{total}} 个",
      syncedNoChange: "上游清单里的模型都已在列，没有新增",
      syncedFromModelsDev: "上游没有返回模型清单，本次由 models.dev 目录补充（可能比上游略有滞后）"
    }
  }
};
const channels$1 = {
  title: "账号渠道",
  description: "浏览器登录第三方编码助手，按账号池共享额度。已连接 {{connected}} / {{total}} 个渠道。",
  connected: "已连接",
  notConnected: "未连接",
  statAccounts: "账号",
  statModels: "模型",
  statCredits: "剩余积分",
  creditsReported: "{{reported}}/{{total}} 个账号有读数",
  creditsDisabled: "已停用",
  addAccount: "添加账号",
  claim: "领取积分",
  claimDone: "领取完成",
  claimSummary: "新领 {{claimed}}，今日已领 {{already}}，失败 {{failed}}，共 +{{total}}",
  claimFailed: "领取失败",
  device: {
    button: "设备号",
    title: "{{name}} 的签到设备号",
    hint: "TRAE 只允许官方客户端登记过的 16 位设备号签到，自己生成的值会被上游拒绝（9074）。",
    label: "16 位设备号",
    placeholder: "例如 2235123456787879",
    reading: "正在读取本机官方客户端的设备号…",
    detected: "本机检测到以下设备号，点一下即可填入：",
    none: "没有在本机官方客户端的 storage.json 里找到设备号。请先在本机登录 TRAE 客户端，或手动填写。",
    where: "位置：%APPDATA%\\Trae CN\\User\\globalStorage\\storage.json 里 iCubeAuthInfo://icube-dc:<16 位> 的键名。每个登录会话留一条。",
    save: "保存设备号",
    saved: "设备号已保存",
    savedHint: "下次签到会用 {{name}} 的这个设备号",
    invalid: "设备号必须是 16 位数字",
    readFailed: "读取设备号失败",
    saveFailed: "保存设备号失败"
  },
  claimTasks: "领取任务积分",
  claimTasksDone: "任务积分领取完成",
  claimTasksError: "任务积分领取失败",
  claimTasksNothing: "没有可领取的任务奖励",
  claimTasksGainsCredit: "+{{credit}}积分",
  claimTasksGainsEnergy: "+{{energy}}能量",
  claimTasksClaimed: "领到 {{count}} 项",
  claimTasksClaimedWithGains: "领到 {{count}} 项（{{gains}}）",
  claimTasksAlready: "{{count}} 项此前已领",
  claimTasksNotClaimable: "{{count}} 项还没做完",
  claimTasksFailed: "{{count}} 项领取失败",
  claimTasksErrors: "{{count}} 个账号没问出结果",
  listSeparator: "，",
  tasks: {
    accept: "接取任务",
    list: "任务清单",
    acceptDone: "任务接单完成",
    acceptError: "任务接单失败",
    accepted: "接了 {{count}} 项",
    untouched: "{{count}} 项无需接单",
    acceptErrors: "{{count}} 个账号没问出结果",
    acceptNote: "接下来正常使用就会陆续完成",
    acceptNothing: "没有需要接单的任务",
    readFailed: "任务清单读取失败",
    copyTerm: "复制「{{term}}」",
    copied: "已复制",
    copyFailed: "复制失败（浏览器拒绝了剪贴板写入，请手动选中）",
    gainsBuddy: "限定款 Buddy",
    status: {
      not_accepted: "未接单",
      accepted: "已接单",
      in_progress: "进行中",
      completed: "可领取",
      claimed: "已领取"
    }
  },
  autoCheckin: {
    title: "自动领取签到积分",
    description: "开启后每天自动为所有已连接渠道的账号领取签到积分；未完成的渠道（失败、未到刷新时间）会自动重试，直到当天全部完成。",
    on: "已开启",
    off: "已关闭",
    running: "正在领取…",
    pending: "今天还有 {{count}} 个渠道未完成，稍后自动重试",
    ranToday: "今天已自动领取（{{date}}）",
    last: "上次领取：{{result}} · {{time}}",
    channelLine: "{{name}}：{{status}}",
    never: "尚未自动领取过",
    unavailable: "渠道运行时未启动，暂时读不到这个开关"
  },
  autoGrowth: {
    title: "自动领取已完成的成长任务",
    description: "开启后每天自动把已完成但没领的成长任务领掉（只领不接单）；还没做完的项留给你在客户端里做。默认关闭。",
    on: "已开启",
    off: "已关闭",
    running: "正在领取…",
    pending: "今天还有 {{count}} 个渠道有失败项，稍后自动重试",
    ranToday: "今天已自动领取（{{date}}）",
    last: "上次领取：{{result}} · {{time}}",
    never: "尚未自动领取过",
    unavailable: "渠道运行时未启动，暂时读不到这个开关"
  },
  models: {
    annotate: "标注",
    annotateHint: "查看渠道声明的参数，并用第三方标准台账逐字段补全",
    annotateBlocked: "该模型已停用或已失效，不在供应商目录里，无法标注或采用",
    title: "模型列表",
    refresh: "在线更新模型",
    refreshed: "模型已更新",
    refreshedCount: "当前可用 {{count}} 个模型",
    refreshFailed: "更新模型失败",
    updateFailed: "更新模型失败",
    disableModel: "关闭此模型",
    enableModel: "启用此模型",
    restoreModel: "重新显示",
    restored: "已恢复失效模型",
    restoredCount: "恢复了 {{count}} 个模型",
    free: "免费",
    disabled: "已关闭",
    dead: "已失效",
    empty: "还没有可用模型：先添加账号，再点「在线更新模型」",
    source: {
      badgeCache: "目录：本地缓存",
      badgeFallback: "目录：内置兜底",
      noticeCache: "官方模型接口已变更或当前不可用，这份清单来自本机官方客户端缓存（不是上游现取），可能比官网略有延迟；聊天仍使用这些模型。",
      noticeFallback: "官方模型接口已变更或当前不可用，且本机官方客户端缓存不可读；当前显示内置兜底目录，可能缺少新模型或包含已下架模型。",
      toastCache: "目录来自官方客户端缓存（上游未返回可用目录）",
      toastFallback: "目录来自内置兜底（上游未返回可用目录）"
    }
  },
  identityRisk: {
    high: "身份风险高",
    medium: "身份风险中",
    low: "身份风险低"
  },
  identityRiskTooltip: "该渠道以官方客户端身份发包：{{declared}}。上游客户端版本会持续变化，并可能据此把账号判定为「非官方渠道使用」并停止服务。",
  identityLive: {
    title: "当前生效",
    source: {
      env: "用户指定",
      official: "官方接口",
      "local-install": "本机安装",
      fallback: "内置兜底"
    },
    checkedAt: "核对于 {{time}}",
    badge: {
      fresh: "版本跟随官方",
      stale: "版本兜底，可能过期"
    },
    badgeTooltip: "当前发包版本 v{{version}}（{{source}}，核对于 {{time}}）。{{state}}",
    badgeState: {
      fresh: "该值来自官方接口 / 本机安装 / 用户指定，官方客户端升级后会自动跟随。",
      stale: "该值来自代码内置常量（官方接口与本机安装都取不到），可能已落后于官方现役版本。"
    }
  },
  serviceStopped: "上游已停止服务",
  refreshAccount: "刷新凭据",
  refreshedAccount: "凭据已刷新",
  refreshAccountFailed: "刷新凭据失败",
  moveUp: "上移",
  moveDown: "下移",
  reorderFailed: "调整顺序失败",
  removeConfirm: "移除 {{name}} 的全部账号？",
  removed: "已移除 {{name}}",
  loginKind: {
    browser: "浏览器登录",
    "device-code": "设备码",
    sms: "短信验证",
    oauth: "OAuth 授权",
    "api-key": "粘贴 API key"
  },
  login: {
    title: "登录 {{name}}",
    starting: "正在打开登录页面…",
    waiting: "等待你在浏览器里完成登录…",
    success: "账号已添加",
    failed: "登录失败",
    timeout: "登录超时，请重试",
    hint: {
      browser: "已在系统浏览器打开授权页面；完成登录后本页会自动更新。若没有弹出，请检查系统浏览器。",
      "device-code": "请在打开的页面里完成设备授权；完成后本页会自动更新。",
      sms: "请在打开的页面里完成短信验证；完成后本页会自动更新。",
      oauth: "已在系统浏览器打开授权页面；同意授权后本页会自动更新。",
      "api-key": "这一家不跳浏览器：加一条匿名槽即可使用免费车道（无需凭据），或粘贴你自己的 API key 解锁收费模型。"
    }
  },
  credential: {
    title: "{{name}} 添加账号",
    hint: "这一家不跳浏览器：加一条匿名槽即可使用免费车道；也可以粘贴自己的 API key 解锁收费模型。",
    keyLabel: "API key",
    keyPlaceholder: "sk-…（在 opencode.ai/auth 生成）",
    nicknameLabel: "备注名（可选）",
    nicknamePlaceholder: "例如：主力号",
    addKey: "用这把 key 添加",
    addAnonymous: "加一条匿名槽",
    anonymousHint: "匿名槽不需要凭据，但按出口 IP 限额；额度用尽时同一出口的多条槽会一起失败。",
    addedKey: "已添加 API key 账号",
    addedAnonymous: "已添加匿名通道",
    keyRequired: "请先填入 API key，或者改点「加一条匿名槽」。",
    failed: "添加失败",
    misconfigured: "这个渠道没有声明加账号的方法，无法从界面添加。"
  }
};
const connect$1 = {
  title: "连接到 ModelPort 网关",
  subtitle: "这个页面是管理界面，网关本体作为无头服务运行。",
  secretLabel: "管理口令",
  submit: "连接",
  connecting: "正在连接…",
  unauthorized: "网关拒绝了这条管理口令。",
  unreachable: "连不上网关：{{message}}",
  daemonKeepsRunning: "关掉这个标签页不会停止网关，它会继续服务请求。",
  retrieving: "正在从系统密钥库取回这台网关的口令…",
  remembered: "在这个壳里，连接成功后口令会存进系统密钥库（只有当前 Windows 用户能解开）。换机器或换用户登录后会再问一次。"
};
const zhCN = {
  header: header$1,
  nav: nav$1,
  dashboard: dashboard$1,
  providers: providers$1,
  proxy: proxy$1,
  gateways: gateways$1,
  apiKeys: apiKeys$1,
  logs: logs$1,
  settings: settings$1,
  common: common$1,
  proxyStatus: proxyStatus$1,
  quickActions: quickActions$1,
  oauth: oauth$1,
  models: models$1,
  modelEditor: modelEditor$1,
  about: about$1,
  session: session$1,
  compression: compression$1,
  promptCaching: promptCaching$1,
  anthropicInbound: anthropicInbound$1,
  contextManagement: contextManagement$1,
  aggregate: aggregate$1,
  channels: channels$1,
  connect: connect$1
};
const header = {
  switchToEnglish: "Switch to English",
  switchToChinese: "Switch to Chinese"
};
const nav = {
  dashboard: "Dashboard",
  providers: "Providers",
  aggregate: "Aggregate Channels",
  channels: "Account Channels",
  proxy: "Proxy Settings",
  models: "Models",
  logs: "Logs",
  settings: "Settings",
  gatewayManager: "Gateway Manager",
  about: "About"
};
const dashboard = {
  title: "Dashboard",
  description: "System overview and real-time monitoring",
  running: "Running",
  stopped: "Stopped",
  totalRequests: "Total Requests",
  successRate: "Success Rate",
  avgLatency: "Avg Latency",
  avgResponseTime: "Avg Response Time",
  activeAccountCount: "Active Account Count",
  port: "Port",
  startProxy: "Start Proxy",
  stopProxy: "Stop Proxy",
  recentActivity: "Recent Activity",
  noActivity: "No recent activity",
  requestsTrend: "Requests Trend",
  chartEmptyHint: "Request volume will appear here once traffic reaches the proxy.",
  chartDayNotRetained: "no retained data",
  trendUnavailable: "no comparison",
  chartRetentionGap: "Recorded history starts later; no data for: {{days}}",
  tokenUsage: {
    title: "Tokens today",
    upstream: "Upstream reported",
    estimated: "Local estimate",
    estimatedHint: "Approximated at ~4 chars per token when the provider reported no usage. For local metering only - never a billing figure.",
    coverage: "{{percent}} of requests carried upstream usage",
    cacheRead: "of which cache reads",
    cacheReadHint: "Input tokens the upstream itself reported as cache hits, against total reported input. This row appears only when an upstream actually reports it — its absence does not mean caching failed, only that this path carries no measurable figure.",
    saved: "Saved by compression",
    savedHint: "counts only compression that took effect",
    savedDisabled: "context compression is off",
    savedDisabledHint: 'This row shows "-" instead of 0: the compression switch is off, so nothing was ever allowed to compress today. The 0 would not mean "saved nothing" - it would mean "never measured". Turn compression on in Settings and this becomes a real figure.',
    noData: "No requests today"
  },
  providerStats: "Provider Statistics",
  avgResponse: "Avg response",
  cost: "Cost",
  tokenTotal: "Tokens",
  providerWindow: {
    today: "Today",
    days: "Last {{count}}d",
    all: "All time",
    custom: "Custom",
    from: "From",
    to: "To",
    invalidRange: "Start date is after the end date",
    outcomeFrom: "Success rate and avg response are recorded per provider from {{day}",
    outcomeMissing: "No per-provider outcomes were recorded for this period",
    probe: "Probe",
    probeHint: "Health-check probe latency, independent of the selected period",
    tokenMissing: "No per-provider token usage recorded for this period yet",
    tokenFrom: "Per-provider token records start on {{day}}",
    costHint: "Estimated from upstream-reported usage at third-party prices (models.dev) only; free and in-plan models count as $0, unpriced requests are left out. {{costed}} of {{requests}} requests in this period are priceable.",
    costMissing: "Nothing in this period had price evidence - that is not the same as costing nothing"
  },
  modelCache: {
    title: "Cache hits by model",
    model: "Model",
    requests: "Requests",
    upstream: "Upstream",
    input: "Input",
    cacheRead: "Cache read",
    hitRate: "Hit rate",
    coverageHint: "{{upstream}} of {{requests}} requests carried upstream usage",
    missing: "not reported",
    noData: "No per-model token records for this period",
    expand: "Show all ({{count}})",
    collapse: "Collapse",
    note: 'Cache read is what the upstream itself reported and is a subset of input. A model without upstream usage shows "-", not 0%.',
    coverageNote: "The per-model split covers {{covered}} of {{total}} requests in this period; records written before it existed carry no model attribution."
  },
  lastUpdated: "Last Updated",
  refresh: "Refresh",
  browserMode: "Browser Mode",
  browserModeDesc: "You are previewing this app in a browser. Full features require running in Electron.",
  proxyRunning: "Proxy service is running",
  proxyStopped: "Proxy service is stopped",
  runtime: "Runtime",
  vsYesterday: "vs yesterday",
  hours: "hours",
  minutes: "minutes",
  justNow: "Just now",
  minutesAgo: "{{count}}m ago",
  hoursAgo: "{{count}}h ago",
  daysAgo: "{{count}}d ago"
};
const providers = {
  title: "Provider Management",
  subtitle: "Manage your API provider configurations and accounts",
  addProvider: "Add Provider",
  editProvider: "Edit Provider",
  deleteProvider: "Delete Provider",
  duplicateProvider: "Duplicate Provider",
  providerName: "Provider Name",
  builtin: "Built-in",
  custom: "Custom",
  apiEndpoint: "API Endpoint",
  description: "Description",
  descriptionPlaceholder: "Enter description (optional)",
  supportedModels: "Supported Models",
  supportedModelsHelp: "Click to add or remove models",
  models: "Models",
  modelNamePlaceholder: "Enter model name",
  headersConfig: "Headers Config",
  headerName: "Header Name",
  headerValue: "Header Value",
  credentialFields: "Credentials",
  credentialFieldsHelp: "Click to add or remove credential fields",
  accounts: "Accounts",
  accountManagement: "Accounts",
  modelUsage: "Model Usage",
  providerDistribution: "Provider Distribution",
  addAccount: "Add Account",
  editAccount: "Edit Account",
  deleteAccount: "Delete Account",
  accountName: "Account Name",
  credentials: "Credentials",
  status: "Status",
  online: "Online",
  offline: "Offline",
  unknown: "Unknown",
  checkStatus: "Check Status",
  lastCheck: "Last Check",
  dailyLimit: "Daily Limit",
  usedToday: "Used Today",
  confirmDelete: "Are you sure you want to delete this provider?",
  confirmDeleteAccount: "Are you sure you want to delete this account?",
  enabled: "Enabled",
  disabled: "Disabled",
  providerEnabled: "Provider enabled",
  providerDisabled: "Provider disabled",
  operationFailed: "Operation failed",
  cannotUpdateProviderStatus: "Cannot update provider status",
  deleteSuccess: "Delete successful",
  providerDeleted: "Provider has been deleted",
  deleteFailed: "Delete failed",
  cannotDeleteProvider: "Cannot delete provider",
  duplicateSuccess: "Duplicate successful",
  providerDuplicated: "Provider has been duplicated",
  duplicateFailed: "Duplicate failed",
  cannotDuplicateProvider: "Cannot duplicate provider",
  providerOnline: "Provider is online",
  providerOffline: "Provider is offline",
  statusUnknown: "Status unknown",
  statusReasons: {
    channel_runtime_running: "The account-channel runtime is running",
    channel_runtime_stopped: "The account-channel runtime is not started yet; a request starts it"
  },
  latency: "Latency",
  checkFailed: "Check failed",
  cannotCheckProviderStatus: "Cannot check provider status",
  statusRefreshed: "Status refreshed",
  refreshFailed: "Refresh failed",
  cannotRefreshProviderStatus: "Cannot refresh provider status",
  addSuccess: "Add successful",
  accountAdded: "Account has been added",
  createSuccess: "Create successful",
  customProviderCreated: "Custom provider has been created",
  updateSuccess: "Update successful",
  providerConfigUpdated: "Provider configuration has been updated",
  createFailed: "Create failed",
  updateFailed: "Update failed",
  addFailed: "Add failed",
  cannotAddAccount: "Cannot add account",
  accountDeleted: "Account has been deleted",
  accountUpdated: "Account has been updated",
  validateSuccess: "Validation successful",
  credentialsValid: "Credentials are valid",
  validateFailed: "Validation failed",
  credentialsInvalid: "Credentials are invalid",
  justNow: "Just now",
  loading: "Loading...",
  noProvidersFound: "No providers found",
  tryAdjustingFilters: "Try adjusting search criteria or filters",
  clickToAddProvider: "Click the button above to add your first provider",
  backToProviderList: "Back to provider list",
  manageAllAccounts: "Manage all accounts under this provider",
  searchProviders: "Search providers...",
  allTypes: "All Types",
  enabledOnly: "Enabled Only",
  disabledOnly: "Disabled Only",
  allStatus: "All Status",
  total: "Total",
  onlineCount: "Online",
  authType: "Auth Type",
  authLabels: {
    token: "API Key",
    userToken: "User Token",
    cookie: "Cookie",
    oauth: "OAuth",
    refresh_token: "Refresh Token",
    jwt: "JWT",
    realUserID_token: "UserID + Token",
    tongyi_sso_ticket: "SSO Ticket"
  },
  authTokenDesc: "Use an API key issued by the endpoint",
  authUserTokenDesc: "A user-level token (e.g. DeepSeek)",
  authRefreshTokenDesc: "Exchange a refresh token for new credentials (e.g. GLM)",
  authJwtDesc: "JWT / refresh token (e.g. Kimi)",
  authUserIdTokenDesc: "Submit realUserID together with a JWT (e.g. MiniMax)",
  authSsoDesc: "Tongyi SSO ticket (e.g. Qwen)",
  authCookieDesc: "A full cookie bundle, for endpoints that only accept a web session",
  authOAuthDesc: "Run the OAuth flow and capture credentials after login",
  selectProvider: "Select a built-in provider, the system will guide you through authentication",
  builtinProviders: "Built-in Providers",
  customProviders: "Custom Providers",
  customProviderNotSupported: "Not supported yet",
  createCustomProvider: "Create Custom Provider",
  createCustomProviderDesc: "Configure your own API provider with multiple authentication methods",
  startCreating: "Start Creating",
  processing: "Processing...",
  collapse: "Collapse",
  active: "Active",
  inactive: "Inactive",
  expired: "Expired",
  accountNamePlaceholder: "Enter account name",
  dailyLimitOptional: "Daily Limit (Optional)",
  dailyLimitPlaceholder: "Maximum requests per day",
  credentialsKeepHint: "Saved credentials are never shown; leave a field empty to keep it, or type a new value to replace it.",
  validationSuccess: "Validation Successful",
  noCredentialsRequired: "This provider needs no credentials — add it directly; requests run through the local runtime.",
  quota: "Quota",
  validateCredentials: "Validate Credentials",
  saving: "Saving...",
  saveChanges: "Save Changes",
  required: "Required",
  enterApiToken: "Enter API Token",
  enterCookieString: "Enter complete Cookie string",
  enterOAuthAccessToken: "Enter OAuth Access Token",
  enterRefreshToken: "Enter Refresh Token",
  enterJwtToken: "Enter JWT Token (starts with eyJ)",
  fillRequiredFields: "Please fill in required fields: {{fields}}",
  enterAccountName: "Please enter account name",
  saveFailed: "Save failed",
  last7days: "Last 7 days",
  sampleData: "Sample data",
  updateModels: "Update Models",
  manageModels: "Manage Models",
  updateModelsSuccess: "Model list updated successfully",
  updateModelsFailed: "Failed to update model list",
  updateModelsNotSupported: "This provider does not support dynamic model updates",
  updatingModels: "Updating model list...",
  updateModelsCountDesc: "Fetched {{fetched}} models, {{added}} of them are new",
  updateModelsNoChangeDesc: "Fetched {{fetched}} models, none of them new",
  updateModelsNoAccountDesc: "No active account for this provider; the online list needs a logged-in session",
  updateModelsMissingFieldDesc: "An account is selected, but the list request needs credential fields this account does not have: {{detail}}",
  updateModelsHttpStatusDesc: "Upstream replied with a non-200 status: {{detail}}",
  updateModelsEmptyDesc: "The list response contained no usable model entries",
  updateModelsShapeDesc: "Unrecognised response shape, nothing was stored: {{detail}}",
  updateModelsNetworkDesc: "Requesting the upstream list failed: {{detail}}",
  updateModelsInvalidKeyDesc: "Every stored key was rejected by the model list endpoint: {{detail}}",
  never: "Never",
  nearLimit: "Remaining quota is near its limit",
  providerNameRequired: "Name is required",
  apiEndpointRequired: "API endpoint is required",
  apiEndpointInvalid: "API endpoint is invalid"
};
const proxy = {
  title: "Proxy Settings",
  description: "Configure API proxy service parameters and management policies",
  statistics: "Runtime Statistics",
  basicConfig: "Basic Config",
  basicConfigDesc: "Configure basic parameters for proxy service",
  loadingSettings: "Loading saved proxy settings… (inputs stay hidden so defaults are never saved as the current state)",
  loadBalancing: "Load Balancing",
  advancedConfig: "Advanced Config",
  advancedConfigDesc: "Configure timeout, retry, and logging options",
  roundRobin: "Round Robin",
  fillFirst: "Fill First",
  failover: "Failover",
  smart: "Soonest reset",
  pace: "Pace allowance",
  modelMappingConfig: "Model Mapping Configuration",
  unsaved: "Unsaved",
  modelMappingDesc: "Map request models to actual models used",
  searchMappings: "Search mappings...",
  addMapping: "Add Mapping",
  requestModel: "Request Model",
  actualModel: "Actual Model",
  preferredProvider: "Preferred Provider",
  preferredAccount: "Preferred Account",
  auto: "Auto",
  noMappings: "No mapping rules",
  noMappingsDesc: 'Click "Add Mapping" to create a new model mapping',
  wildcardUnsupported: "Not supported: mappings are looked up by exact model name, so a '*' entry never matches.",
  saveConfig: "Save Configuration",
  editMapping: "Edit Mapping",
  addMappingDesc: "Configure request model to actual model mapping rules",
  requestModelPlaceholder: "gpt-4",
  requestModelHelp: "Model name requested by the client; matched exactly",
  actualModelHelp: "Actual model name sent to provider",
  selectModel: "Select Model",
  noModelFound: "No matching model found",
  preferredProviderOptional: "Preferred Provider (Optional)",
  autoSelect: "Auto Select",
  preferredAccountOptional: "Preferred Account (Optional)",
  selectProviderFirst: "Please select provider first",
  validationFailed: "Validation Failed",
  requestActualModelRequired: "Request model and actual model cannot be empty",
  mappingExists: "Mapping rule already exists for this request model",
  mappingAddedPending: "Model mapping {{model}} added (pending save)",
  mappingUpdatedPending: "Model mapping {{model}} modified (pending save)",
  mappingDeletedPending: "Model mapping {{model}} deleted (pending save)",
  configSaved: "Model mapping configuration saved",
  configSaveFailed: "Failed to save configuration",
  unsavedChangesWarning: "You have unsaved changes. Are you sure you want to leave?",
  unsavedChangesHint: "You have unsaved changes, click save button to save",
  unsavedChangesTitle: "Unsaved Changes",
  unsavedChangesDescription: "You have unsaved model mapping changes. If you leave, these changes will be lost.",
  discardAndLeave: "Discard Changes and Leave",
  changesDiscarded: "Unsaved changes have been discarded",
  portMustBeNumber: "Port must be a number",
  listeningPort: "Listening Port",
  portRange: "Port number for proxy service (1-65535)",
  portRangeError: "Port must be between 1-65535",
  portPrivilege: "Ports below 1024 require administrator privileges",
  bindAddress: "Bind Address",
  bindAddressEmpty: "Bind address cannot be empty",
  invalidIpOrHostname: "Please enter a valid IP address or hostname",
  bindAddressHelp: "0.0.0.0 allows all network access, 127.0.0.1 for local only",
  httpsEnabled: "Enable HTTPS",
  httpsEnabledHelp: "Adds a TLS listener for clients that refuse plain HTTP (e.g. Claude Desktop). The HTTP port keeps working.",
  httpsPort: "HTTPS port",
  httpsPortHelp: "Must differ from the HTTP port",
  httpsPortConflict: "HTTPS port must differ from the HTTP port",
  httpsClientUrl: "Client URL",
  httpsClientUrlHelp: "Paste this into Claude Desktop's Gateway base URL. Do not append /v1; it adds /v1/messages itself.",
  httpsCertificate: "Certificate",
  httpsCertPath: "Certificate file",
  httpsCertValidTo: "Valid until",
  httpsCertTrust: "System trust",
  httpsCertTrusted: "Trusted",
  httpsCertUntrusted: "Not trusted",
  httpsCertTrustUnknown: "Cannot determine automatically",
  httpsCertNotGenerated: "The certificate is generated the first time the proxy starts with HTTPS",
  httpsInstallTrust: "Install into system trust",
  httpsInstalling: "Installing...",
  httpsUninstallTrust: "Remove from system trust",
  httpsUninstalling: "Removing...",
  httpsTrustRemoved: "Certificate removed from the trust store",
  httpsTrustRemoveFailed: "Failed to remove the certificate",
  httpsInstallTrustHelp: "Writes to the current user's Trusted Root store; the OS shows one confirmation and no administrator rights are needed. Affects only clients that read the system trust store (Claude Desktop, browsers). Restart the client afterwards.",
  httpsTrustInstalled: "Certificate installed",
  httpsTrustFailed: "Certificate installation failed",
  httpsCertPairRequired: "Certificate and private key must be provided together",
  httpsCertPathLabel: "Custom certificate (optional)",
  httpsCertPathPlaceholder: "Leave empty to use the generated certificate",
  httpsKeyPathLabel: "Custom private key (optional)",
  httpsKeyPathPlaceholder: "Provide it together with the certificate",
  httpsSanHosts: "Addresses in the certificate (IPs, comma-separated)",
  httpsSanHostsHelp: "List the address remote clients actually connect to; localhost / 127.0.0.1 / ::1 are always included. Changing this reissues the certificate, so install the trust once more.",
  httpsSanInvalid: "Not a valid IP or hostname",
  httpsCertSan: "Certificate covers",
  httpsRemoteTrustHint: "The certificate has to be trusted on the machine that runs the client. Inside the console that is the block above; on any other computer, fetch the same PEM with GET /v1/management/tls/ca and install it there.",
  httpsHandshakeRejections: "Rejected handshakes",
  httpsHandshakeNone: "none since the listener started",
  httpsHandshakeCount: "{{total}} since the listener started, {{certificate}} of them certificate rejections ({{codes}})",
  httpsNodeClientEnv: "For Node-based clients on the gateway machine",
  httpsCopyCa: "Copy",
  httpsNodeClientHelp: "Node clients (Codex CLI, the WorkBuddy/CodeBuddy agent, anything built on node:https or undici) never read the system trust store - they trust their bundled CA set plus NODE_EXTRA_CA_CERTS. Point that variable at this file and restart the client.",
  httpsCaCopied: "Environment line copied",
  httpsCaCopyFailed: "Could not write to the clipboard",
  httpsGatewayTrust: "Gateway machine trust",
  httpsHandshakeGatewayNote: "Counted on the gateway machine: a handshake refused by a client never became a request row there.",
  httpsMachineTrust: "This computer",
  httpsMachineTrustState: "Trust on this computer",
  httpsMachineFingerprint: "Fingerprint (SHA-256)",
  httpsMachineCertPath: "Certificate on this computer",
  httpsMachineNodeEnv: "For Node-based clients on this computer",
  httpsMachineUnavailable: "The console has not read the gateway certificate yet, so this computer has nothing to trust.",
  httpsMachineInstallHelp: "Writes to the current user's Trusted Root store on this computer only; the gateway machine keeps whatever it already has. Check the fingerprint before installing, and restart the client afterwards.",
  httpsMachineManual: "This platform has no trust command the console can run: add the certificate above with the system tool, then compare the fingerprint.",
  httpsBootstrapHint: "If HTTPS itself will not load, the console's connection-failure page offers the same install - an untrusted certificate leaves no page to click a button on.",
  saving: "Saving...",
  proxyConfigUpdated: "Proxy configuration has been updated",
  fixFormErrors: "Please fix the errors in the form",
  loadBalanceConfig: "Load Balance Configuration",
  loadBalanceConfigDesc: "Configure account selection strategy and weight distribution",
  loadBalanceStrategy: "Load Balance Strategy",
  selectStrategy: "Select Strategy",
  roundRobinDesc: "Use each available account in sequence for even request distribution",
  fillFirstDesc: "Prioritize current account until limit reached, then switch to next",
  failoverDesc: "Automatically skip failed accounts. Switch to other accounts after 3 consecutive failures, auto-recover after 1 minute",
  smartDesc: "Prefer the account whose quota renews soonest, so allowance about to reset gets used instead of wasted",
  paceDesc: "Prefer the account with the most allowance left per hour until its window resets",
  accountWeightConfig: "Account Weight Configuration",
  repetitionGuardTitle: "Degenerate stream detection",
  repetitionGuardDesc: "Marks a streamed answer whose trailing lines collapsed into duplicates as a degraded success: the scorer stops treating it as a clean win and the conversation is not pinned to that model. The shipped default is calibrated on 99 real reasoning blocks (healthy median 1.000; 0.80 flags 9 of them).",
  repetitionGuardMinLines: "Minimum lines judged",
  repetitionGuardMaxRatio: "Duplicate-line ratio threshold",
  repetitionGuardMaxRatioHelp: "Unique lines / total lines over the trailing window, at or below this counts as degenerate. The client-side guard aborted at 0.35, so the gateway stays deliberately looser and never condemns a stream the client accepted.",
  repetitionGuardNonStreamNote: "Streaming responses only. A non-streaming response has no per-chunk signal and its body is kept only when body logging is on, so that path is deliberately not judged.",
  weightHelp: "Higher weight means higher probability of selection. Only effective in round-robin strategy.",
  autoRoutingMaxAttempts: "Failover attempts",
  autoRoutingMaxAttemptsHelp: "How many candidates one request may try before it gives up on account-level failures (5xx, network). Recoverable rejections - queueing, quota, a model this channel no longer serves - keep switching until the 90s wall-clock budget instead, and are no longer capped at this number",
  autoRoutingSticky: "Conversation stickiness (minutes)",
  autoRoutingStickyHelp: "Reuse the model that last succeeded for the same conversation within this window; set to 0 to disable",
  autoRoutingStickyHardPin: "Hard-pin the sticky model (route it first regardless of score)",
  autoRoutingStickyHardPinHelp: "On: the model this conversation last succeeded on is moved to the front of the candidate list, so an agent session does not change model mid-task. Off: stickiness is only a score bonus (+0.12, or +0.06 for another account of the same model), and a clearly better candidate wins it.",
  autoRoutingStickyHardPinIdle: "Stickiness is already off (the window above is 0), so this setting does nothing right now.",
  autoRoutingFairness: "Share rotation lead (dispatches)",
  autoRoutingFairnessHelp: "How far a model may run ahead of the least-dispatched model in this route's pool before it moves behind every model that has served less. 0 rotates strictly; 2 (the default) lets one model serve three dispatches in a row; 20 is effectively score-only. Conversation stickiness still keeps one session on one model. Every candidate in the pool is now ranked - nothing is capped to one model per provider - so this is what decides whether the tail of the pool ever gets a turn.",
  autoRoutingPrefer: "Routing preference",
  autoRoutingPreferHelp: "Balanced picks a tier from the request complexity, Fast prefers quick models, Strong prefers capable ones, Cheap prefers free or low-multiplier models. The X-Auto-Prefer header overrides it per request",
  autoRoutingPrefer_balanced: "Balanced (by complexity)",
  autoRoutingPrefer_fast: "Prefer speed",
  autoRoutingPrefer_strong: "Prefer capability",
  autoRoutingPrefer_cheap: "Prefer free",
  noActiveAccounts: "No active accounts",
  addAndActivateAccount: "Please add and activate accounts first",
  failedToGetAccounts: "Failed to get account list",
  requestConfig: "Request Configuration",
  requestTimeout: "Request Timeout (seconds)",
  timeoutMustBeNumber: "Timeout must be a number",
  timeoutRangeError: "Timeout must be between 1-300 seconds",
  timeoutHelp: "Maximum wait time for a single request (1-300 seconds)",
  retryCount: "Retry Count",
  retryCountMustBeNumber: "Retry count must be a number",
  retryCountRangeError: "Retry count must be between 0-10",
  retryCountHelp: "Automatic retry count after request failure (0-10 times)",
  outputCapFallback: "Fallback output cap",
  outputCapFallbackHelp: "The Anthropic protocol requires max_tokens: when the client sends neither spelling and no per-model parameter is set, this value is used. Leave empty for the built-in default of 4096.",
  outputCapMustBeInteger: "Output cap must be an integer",
  outputCapRangeError: "Output cap must be between 1 and 1000000",
  advancedConfigUpdated: "Advanced configuration has been updated",
  restartRequired: "Restart Required",
  restartRequiredDesc: "Port or bind address has changed. The proxy service needs to restart for the changes to take effect. Restart now?",
  restartNow: "Restart Now",
  restarting: "Restarting...",
  proxyRestarted: "Proxy service has been restarted with new configuration",
  proxyRestartFailed: "Failed to restart proxy service",
  autoRoutingPoolStrategy: "Pool strategy filter",
  autoRoutingPoolStrategyHelp: "Check strategies to keep only models that satisfy them. Strategies target models, not accounts, so all accounts of one model are filtered together. No selection means no filtering.",
  "autoRoutingPoolStrategy_vision-capable": "Vision model",
  "autoRoutingPoolStrategy_vision-capable_desc": "Accepts image input",
  "autoRoutingPoolStrategy_tools-capable": "Tool calling",
  "autoRoutingPoolStrategy_tools-capable_desc": "Natively supports function/tool calls",
  autoRoutingPoolStrategy_multimodal: "Multimodal",
  autoRoutingPoolStrategy_multimodal_desc: "Accepts image input (currently approximated by vision)",
  autoRoutingPoolStrategy_reasoning: "Reasoning model",
  autoRoutingPoolStrategy_reasoning_desc: "Strong tier and name contains reason/thinking",
  "autoRoutingPoolStrategy_annotated-only": "Annotated only",
  "autoRoutingPoolStrategy_annotated-only_desc": "At least one capability is explicitly annotated",
  "autoRoutingPoolStrategy_free-only": "Free only",
  "autoRoutingPoolStrategy_free-only_desc": "Cost bucket is free",
  "autoRoutingPoolStrategy_low-weight": "Low weight",
  "autoRoutingPoolStrategy_low-weight_desc": "Credit multiplier is annotated and ≤ 1",
  "autoRoutingPoolStrategy_included-plan": "In subscription plan",
  "autoRoutingPoolStrategy_included-plan_desc": "Aggregate cost class is included",
  "autoRoutingPoolStrategy_cost-known": "Known cost",
  "autoRoutingPoolStrategy_cost-known_desc": "Cost bucket is neither unknown nor missing",
  "autoRoutingPoolStrategy_long-context": "Long context",
  "autoRoutingPoolStrategy_long-context_desc": "Context window ≥ 128000",
  "autoRoutingPoolStrategy_standard-context": "Standard context",
  "autoRoutingPoolStrategy_standard-context_desc": "Context window ≥ 32000",
  "autoRoutingPoolStrategy_fast-tier": "Fast tier",
  "autoRoutingPoolStrategy_fast-tier_desc": "Capability tier is fast",
  "autoRoutingPoolStrategy_strong-tier": "Strong tier",
  "autoRoutingPoolStrategy_strong-tier_desc": "Capability tier is strong",
  "autoRoutingPoolStrategy_balanced-tier": "Balanced tier",
  "autoRoutingPoolStrategy_balanced-tier_desc": "Capability tier is balanced",
  "autoRoutingPoolStrategy_aggregate-only": "Aggregate only",
  "autoRoutingPoolStrategy_aggregate-only_desc": "Keep only aggregate providers",
  "autoRoutingPoolStrategy_channel-only": "Channel only",
  "autoRoutingPoolStrategy_channel-only_desc": "Keep only account-channel providers",
  "autoRoutingPoolStrategy_builtin-only": "Builtin only",
  "autoRoutingPoolStrategy_builtin-only_desc": "Keep only builtin providers",
  "autoRoutingPoolPreset_daily-free": "Daily free",
  "autoRoutingPoolPreset_daily-free_desc": "Free and annotated",
  "autoRoutingPoolPreset_vision-first": "Vision first",
  "autoRoutingPoolPreset_vision-first_desc": "Vision or multimodal",
  "autoRoutingPoolPreset_long-context": "Long context",
  "autoRoutingPoolPreset_long-context_desc": "Keep only long-context models",
  "autoRoutingPoolPreset_low-cost": "Low cost",
  "autoRoutingPoolPreset_low-cost_desc": "Free or low weight",
  "autoRoutingPoolPreset_strong-reasoning": "Strong reasoning",
  "autoRoutingPoolPreset_strong-reasoning_desc": "Reasoning model in strong tier",
  autoRoutingPoolOperator_and: "And",
  autoRoutingPoolOperator_or: "Or",
  autoRoutingPoolOperatorHelp: "Operators apply left to right: And intersects, Or unions. The first strategy operator is ignored.",
  autoRoutingPoolStrategyCategory_capability: "Capability",
  autoRoutingPoolStrategyCategory_cost: "Cost",
  autoRoutingPoolStrategyCategory_context: "Context",
  autoRoutingPoolStrategyCategory_tier: "Tier",
  autoRoutingPoolStrategyCategory_channel: "Channel",
  modelRoutes: "Model routes",
  modelRoutesDesc: "A route is a named request-time pool decision: send its name as the model and candidates are filtered and ranked with this scoring strategy, preference, attempt cap and pool filters. The pool is recomputed from the models served right now on every request, so adding or removing a model needs no route edit.",
  modelRoutesNew: "New route",
  modelRoutesEmpty: "No routes yet",
  modelRoutesEmptyHelp: "Create one and use its name as the model in requests; the route named auto came from the legacy automatic routing config.",
  routesUnavailable: "The routes API is unavailable; restart the app and try again",
  routesLoadFailed: "Failed to load the route list",
  routeNameLabel: "Route name",
  routeNamePlaceholder: "e.g. cheap-fast",
  routeNameHelp: "Lowercase letters, digits, underscore and hyphen, at most 64 characters; it must not clash with an existing route, model name or user alias.",
  routeNameRequired: "Enter a route name",
  routeCreate: "Create route",
  routeSaveChanges: "Save changes",
  routeEnabledSwitch: "Enabled",
  routeStrategy: "Scoring strategy",
  routeStrategyHelp: "Sets only how this route ranks its candidates; the account pick inside a provider still follows the server-wide strategy above.",
  routeRename: "Route name (rename)",
  routeRenameHelp: "Type a new name to rename it: requests have to use the new name from then on and the old one stops resolving at once.",
  routeDeleteConfirmTitle: 'Delete route "{{name}}"?',
  routeDeleteWarning_auto: 'After deleting it, /v1/models stops advertising auto and model="auto" resolves as a plain model name again (no longer a route); if no model carries that name, clients get an unknown-model error.',
  routeDeleteWarning_other: 'After deleting it, /v1/models stops advertising "{{name}}" and requests naming it resolve as a plain model name again (no longer a route); if no model carries that name, clients get an unknown-model error.',
  routeCreatedToast: "Route created and effective immediately",
  routeSavedToast: "Route updated and effective immediately",
  routeUpdatedToast: "Route state updated and effective immediately",
  routeDeletedToast: "Route deleted",
  routeImmediateHelp: "Creating, editing, renaming, toggling and deleting a route persists at once and takes effect on the next request - no proxy restart needed.",
  routeAttemptsSummary: "Up to {{attempts}} failovers on account-level failures",
  routePoolSize: "{{count}} model(s) currently in this route's pool",
  routePoolSizeEmpty: "This route's pool is empty: it is still advertised on /v1/models, but every request to it fails with 503. Loosen its pool strategies, or start more models on the Models page.",
  routePoolSizeUnknown: "Pool size unavailable (could not read the current catalogue)",
  routeStickySummary: "Conversation stickiness {{minutes}} min",
  routePoolManualSummary: "Manual fixes: {{included}} added back · {{excluded}} removed",
  routePoolTitle: "Candidate pool preview & manual fixes",
  routePoolHelp: "The preview runs the same collection/strategy/manual pipeline as a real request and shows where each model ends up. Models wrongly dropped by a strategy can be added back by hand; models you never want picked can be removed. Manual overrides never bypass request hard filters (image → vision, context) or contract filters.",
  routePoolRefresh: "Refresh preview",
  routePoolLoading: "Computing the candidate pool…",
  routePoolNoMatch: "No model matches the filter",
  routePoolSearchPlaceholder: "Search model or provider…",
  routePoolFilter_all: "All models",
  routePoolFilter_kept: "Kept only",
  routePoolFilter_dropped: "Dropped or excluded",
  routePoolFilter_unavailable: "Unavailable for this profile",
  routePoolStatus_kept: "Kept",
  routePoolStatus_included: "Added back",
  routePoolStatus_excluded: "Removed",
  routePoolStatus_filtered: "Filtered",
  routePoolStatus_unavailable: "Unavailable",
  routePoolAdd: "Add to pool",
  routePoolRemove: "Remove from pool",
  "routePoolStatus_not-pinned": "Not pinned",
  routePoolPin: "Pin to this route",
  routePoolUnpin: "Remove from the pinned list",
  routePoolPinnedFlag: "pinned",
  routePinSummary: "Pinned pool: this route can only serve these {{total}} model name(s).",
  routeBasedOn: "Pool source (reference another route)",
  routeBasedOnNone: "Own pool (no reference)",
  routeBasedOnHelp: "Pick an existing route and this route takes its candidate pool, strategies, name pin and manual include/exclude verbatim from it. References are one hop only, so 'A borrows B which borrows C' cannot happen. This is how you give one pool a second client-facing name (an Anthropic tier, say) without copying a config that would then drift apart.",
  routeBasedOnNotice: "Everything about how this route selects comes from '{{route}}'; the strategies and manual include/exclude below do not run. Clear the reference to edit those.",
  routeBasedOnSummary: "Pool comes from {{route}} (the strategies above are not executed by this route)",
  routePoolAuto: "Back to automatic",
  routePoolFilteredBy: 'Dropped by "{{strategy}}"',
  routePoolUnavailable_vision: "Preview profile needs vision",
  routePoolUnavailable_tools: "Preview profile needs tool calling",
  routePoolUnavailable_context: "Context window too small",
  routePoolSummary: "Candidates {{candidates}} · after strategies {{afterStrategies}} · after manual fixes {{afterManual}} · unavailable {{unavailable}}",
  routePoolConflict: '"{{strategy}}" joined with "or" re-admits {{count}} candidates that fail the strategies before it ({{broken}}): those no longer constrain this pool.',
  routePoolEmpty: "No routable model under the current configuration ({{reasons}})",
  routePoolMissing_vision: "no vision model",
  routePoolMissing_tools: "no tool-calling model",
  routePoolMissing_context: "no model with enough context",
  routePoolMissing_pool_strategy: "pool strategies filtered everything out",
  routePoolMissing_manual_filter: "manual removals emptied the pool",
  routePoolUnresolved: "{{count}} manually added model(s) are no longer candidates (stopped or deleted); remove them individually",
  routePoolSampleVision: "Preview request needs images",
  routePoolSampleTools: "Preview request needs tools",
  routePoolSampleTokens: "Estimated context",
  routePoolMark: "Edit capability mark",
  routePoolManualMark: "Manual mark",
  routePoolMarkTitle: "Manual capability mark",
  routePoolMarkHelp: 'Manual marks win over everything and survive model syncs. "Inherit" keeps the automatic result (provider record / aggregate official / static table / third-party / name heuristic).',
  routePoolMarkTier: "Tier",
  routePoolMarkVision: "Vision",
  routePoolMarkTools: "Tool calling",
  routePoolMarkReasoning: "Reasoning",
  routePoolMarkContext: "Context window",
  routePoolMarkMaxOutput: "Max output",
  routePoolMarkMaxOutputPlaceholder: "Not marked (leave blank)",
  routePoolMarkMaxOutputHelp: "Unit: tokens. Leave blank to leave it unmarked (never stored as 0); positive whole numbers only, up to {{max}}.",
  routePoolMarkMaxOutputInvalid: "Enter a positive whole number of tokens (digits only, not 0 or a decimal).",
  routePoolMarkMaxOutputTooLarge: "Max output must not exceed {{max}} tokens.",
  routePoolMarkModalities: "Input modalities",
  routePoolMarkModalitiesHelp: "Leave all unchecked to inherit; once checked, this set is authoritative.",
  routePoolMarkInherit: "Inherit automatic",
  routePoolMarkYes: "Supported",
  routePoolMarkNo: "Not supported",
  routePoolMarkSaveFailed: "Failed to save the mark",
  routePoolSource_manual: "Manual mark",
  "routePoolSource_provider-record": "Provider record",
  "routePoolSource_aggregate-official": "Aggregate official catalogue",
  routePoolSource_catalog: "Adopted standard catalogue",
  routePoolSource_probe: "Measured probe",
  routePoolSource_static: "Built-in static table",
  "routePoolSource_provider-default": "Provider default",
  "routePoolSource_third-party": "Third-party data (models.dev)",
  routePoolSource_heuristic: "Name heuristic",
  routePoolSource_unknown: "Unknown",
  routePoolSourceShort_manual: "manual",
  "routePoolSourceShort_provider-record": "record",
  "routePoolSourceShort_aggregate-official": "official",
  routePoolSourceShort_catalog: "catalogue",
  routePoolSourceShort_probe: "measured",
  routePoolSourceShort_static: "static",
  "routePoolSourceShort_provider-default": "default",
  "routePoolSourceShort_third-party": "3rd",
  routePoolSourceShort_heuristic: "guess",
  routePoolSourceShort_unknown: "?"
};
const gateways = {
  title: "Gateway Manager",
  description: "Gateways reachable from this machine, and what state each one is in.",
  desktopOnly: "The gateway manager is desktop-only: starting, installing and deploying happens on this machine.",
  refresh: "Refresh",
  add: "Add gateway",
  loading: "Reading gateway state…",
  empty: "No gateways configured yet.",
  loadFailed: "Could not read gateway state. Please try again.",
  current: "Current",
  phase: {
    running: "Running",
    stopped: "Stopped",
    "not-installed": "Not installed",
    unreachable: "Unreachable",
    offline: "Offline",
    unknown: "Unknown"
  }
};
const apiKeys = {
  title: "API Key Management",
  description: "Manage API keys for proxy service authentication",
  apiKeyAuth: "API Key Authentication",
  apiKeyAuthDesc: "When enabled, all requests require a valid API Key",
  enableApiKeyAuth: "Enable Authentication",
  currentStatus: "Status",
  apiKeyList: "API Key List",
  totalKeys: "{{count}} API Keys",
  enabledKeys: "{{count}} enabled",
  newApiKey: "New API Key",
  noApiKeys: "No API Keys",
  clickToCreate: "Click the button above to create a new API Key",
  maskHint: "This list shows keys masked to their first and last characters:",
  name: "Name",
  apiKey: "API Key",
  status: "Status",
  usageCount: "Usage Count",
  createdAt: "Created At",
  operations: "Operations",
  "delete": "Delete",
  createApiKey: "Create API Key",
  createApiKeyDesc: "Create a new API Key for proxy service authentication",
  keyName: "Key Name",
  keyNamePlaceholder: "e.g., Production, Testing",
  cancel: "Cancel",
  create: "Create",
  confirmDelete: "Confirm Delete",
  confirmDeleteDesc: "This action cannot be undone. Are you sure you want to delete this API Key?",
  keyEnabled: "API Key enabled",
  keyDisabled: "API Key disabled",
  authEnabled: "API Key authentication enabled",
  authDisabled: "API Key authentication disabled",
  pleaseEnterName: "Please enter a name",
  keyNameRequired: "API Key name cannot be empty",
  copied: "Copied",
  copiedToClipboard: "API Key copied to clipboard",
  deleted: "Deleted",
  keyDeleted: "API Key has been deleted"
};
const logs = {
  pageTitle: "Request Logs",
  pageDescription: "View requests served by the proxy",
  timestamp: "Timestamp",
  clearLogs: "Clear",
  filter: "Filter",
  clearConfirm: "Clear Logs",
  clearConfirmDesc: "Are you sure you want to clear all logs? This action cannot be undone.",
  requestLogs: "Request Logs",
  all: "All",
  noRequestLogs: "No request logs",
  noRequestLogsHint: "Requests will be listed here once traffic reaches the proxy.",
  todayRequests: "Today Requests",
  todaySuccess: "Today Success",
  todayErrors: "Today Errors",
  provider: "Provider",
  account: "Account",
  userInput: "User Input",
  requestBody: "Request Body",
  duration: "Duration",
  latency: "Latency",
  method: "Method",
  url: "URL",
  stream: "Stream",
  responseStatus: "Response Status",
  errorMessage: "Error Message",
  stackTrace: "Stack Trace",
  noRequestData: "No request data",
  bodiesNotRecorded: "Bodies not recorded",
  bodiesNotRecordedHint: 'Body logging is off under the current log settings. Turn on "Persist Bodies" in Settings › Data Management; only requests made after that will show their content here.',
  noUserInput: "No user input",
  noError: "No error",
  tabInfo: "Info",
  tabRequest: "Request",
  tabUserInput: "User Input",
  tabError: "Error",
  tabResponse: "Response",
  responseBody: "Response Body",
  webSearch: "Web Search",
  reasoningEffort: "Reasoning Effort",
  maxTokens: "Max Output Tokens",
  finishReason: "Finish Reason",
  contextFitFits: "fits",
  contextFitOverflow: "overflow",
  contextFitUnknown: "window not published",
  inputTokensEstimate: "Estimated input / window",
  contextFit: "Context fit",
  contextFitMeasured: "measured from upstream error",
  streamTruncated: "Upstream Cut Off",
  truncatedShort: "Cut off",
  attempts: "Attempts",
  streamFirstToken: "First Token",
  streamEndReason: "Stream End",
  streamBytes: "Bytes Out",
  streamPings: "Heartbeats",
  upstreamRequestId: "Upstream Request ID",
  errorType: "Error Type",
  errorCode: "Error Code",
  errorParam: "Error Param",
  upstreamStatus: "Upstream Status",
  saveDiagnosticBundle: "Export Diagnostic Bundle"
};
const settings = {
  title: "Settings",
  description: "Manage application settings and preferences",
  appearance: "Appearance",
  theme: "Theme",
  themeSettingsDesc: "Customize the appearance theme of the application",
  themeLight: "Light",
  themeDark: "Dark",
  language: "Language",
  languageSettingsDesc: "Set the display language of the application",
  languageZh: "简体中文",
  languageEn: "English",
  sidebarCollapsed: "Collapse Sidebar by Default",
  sidebarCollapsedHelp: "Collapse sidebar by default on startup for larger workspace",
  behavior: "Behavior",
  general: "General",
  dataSecurity: "Data & Security",
  expandSidebar: "Expand sidebar",
  collapseSidebar: "Collapse sidebar",
  autoStart: "Auto Start",
  autoStartHelp: "Run the app on system startup, launched hidden so it does not steal focus (Linux writes ~/.config/autostart; inactive in dev mode, available once packaged)",
  autoStartProxy: "Auto Start Proxy",
  autoStartProxyHelp: "Automatically start proxy service when app launches",
  minimizeToTray: "Minimize to Tray",
  minimizeToTrayHelp: "Minimize to system tray when closing window",
  closeBehavior: "Close Behavior",
  closeBehaviorDesc: "Configure application close behavior",
  closeBehaviorMinimize: "Minimize",
  closeBehaviorClose: "Close",
  closeBehaviorAsk: "Ask",
  enableNotifications: "Enable Notifications",
  enableNotificationsHelp: "Show system notifications",
  oauthProxyMode: "OAuth Login Proxy",
  oauthProxyModeHelp: "Set network proxy mode for OAuth login",
  oauthProxySystem: "System Proxy",
  oauthProxyNone: "No Proxy",
  modelRefresh: {
    title: "Scheduled Model List Refresh",
    enabled: "Enable scheduled refresh",
    enabledHelp: "When off, no provider model list is refreshed automatically; manual refresh only",
    shortInterval: "Account channel interval",
    shortIntervalHelp: "Account channels use a local RPC (zero network cost); lists change rarely, default 1 week",
    longInterval: "Aggregate / builtin interval",
    longIntervalHelp: "Aggregate and builtin are real HTTP hits upstream; keep sparse, default 2 weeks",
    accountChannels: "Account channels",
    accountChannelsHelp: "13 channels, warm the in-memory cache via local model.list RPC (no disk write, no broadcast)",
    aggregate: "Aggregate catalogue",
    aggregateHelp: "Walk configured aggregate entries and run syncModels to align with upstream",
    builtin: "Built-in providers",
    builtinHelp: "Real HTTP re-fetch for builtin providers with modelsFetch (currently empty)",
    triggerNow: "Refresh now",
    triggerNowHelp: "Run one round of refresh for all enabled categories immediately",
    triggerBtn: "Refresh now",
    triggering: "Refreshing…",
    triggerError: "Refresh failed: {{reason}}",
    week1: "1 week",
    week2: "2 weeks",
    month1: "1 month",
    month3: "3 months",
    month6: "6 months"
  },
  logSettings: "Log Settings",
  logLevel: "Log Level",
  logLevelHelp: "Select log recording level",
  selectLogLevel: "Select Log Level",
  logRetentionDays: "Log Retention Days",
  logRetentionHelp: "Logs older than this will be automatically cleaned",
  maxLogs: "Max Logs",
  maxLogsHelp: "Oldest logs will be cleaned when exceeded",
  requestLogEnabled: "Persist Request Logs",
  requestLogEnabledHelp: "Store structured request logs for diagnostics and statistics",
  requestLogMaxEntries: "Request Log Cap",
  requestLogMaxEntriesHelp: "Keep only the newest persisted request logs. Set to 0 to disable storage.",
  requestLogIncludeBodies: "Persist Bodies",
  requestLogIncludeBodiesHelp: "Store request and response bodies in request logs",
  requestLogMaxBodyChars: "Body Character Limit",
  requestLogMaxBodyCharsHelp: "Maximum characters persisted per request or response body",
  requestLogRedactSensitive: "Redact Sensitive Data",
  requestLogRedactSensitiveHelp: "Mask tokens, cookies, API keys, and similar secrets before persisting",
  dataManagement: "Interface Preferences",
  dataManagementDesc: 'Only syncs UI preferences such as theme, language and log level - no providers, accounts or credentials. Use "Full backup & migration" above for a real migration.',
  exportConfig: "Export Preferences",
  importConfig: "Import Preferences",
  exporting: "Exporting...",
  importing: "Importing...",
  exportSuccess: "Configuration exported successfully",
  exportFailed: "Failed to export configuration",
  importSuccess: 'Preferences imported; they apply after the restart. Providers, accounts and credentials are not part of this file - use "Full backup & migration" above.',
  importFailed: "Invalid configuration file format",
  backup: {
    title: "Full Backup & Migration",
    description: "Export every piece of data and configuration, then import it on another machine - credentials and channel logins included",
    contains: "This backup contains:",
    containsProviders: "Providers, aggregate entries and custom endpoints",
    containsAccounts: "Account credentials (API keys / cookies / refresh tokens)",
    containsConfig: "Routes, model aliases, proxy API keys, management secret and model marks",
    containsChannels: "Channel accounts and their login state",
    "export": "Export Full Backup",
    "import": "Import Backup",
    reading: "Reading...",
    restartHint: "Importing replaces or tops up local data; the app must restart before it takes effect.",
    exportTitle: "Export Full Backup",
    exportDesc: "The file contains credentials in plaintext by default - encrypt it with a password before saving.",
    includeStatistics: "Include statistics",
    includeStatisticsHelp: "Request counters, token ledger and other historical totals",
    includeLogs: "Include logs",
    includeLogsHelp: "Request and application logs; large, and they contain user input fragments",
    encrypt: "Encrypt with a password",
    encryptHelp: "scrypt + AES-256-GCM; the same password opens it on any machine",
    password: "Password",
    passwordConfirm: "Confirm password",
    passwordPlaceholder: "At least 8 characters",
    passwordHelp: "The password is never stored. Lose it and the backup cannot be restored.",
    plaintextWarning: "With encryption off, the file holds upstream API keys and session cookies in plaintext. Keep it somewhere trusted and delete it after importing.",
    passwordMismatch: "The two passwords do not match",
    exportConfirm: "Choose Location & Export",
    exporting: "Exporting...",
    exportSuccess: "Backup exported",
    exportSuccessDesc: "{{size}} - {{providers}} providers, {{accounts}} accounts",
    unlockTitle: "Enter Backup Password",
    unlockDesc: "This backup is password-encrypted. Enter the password you set when exporting it.",
    unlock: "Unlock",
    unlocking: "Unlocking...",
    previewTitle: "Confirm Import",
    previewDesc: "These numbers come from the backup file itself; check them before importing.",
    countProviders: "Providers",
    countAccounts: "Accounts",
    countWithCredentials: "{{n}} with credentials",
    countRoutes: "Routes",
    countMappings: "Model aliases",
    countApiKeys: "Proxy API keys",
    countChannelAccounts: "Channel accounts",
    countRequestLogs: "Request logs",
    countAppLogs: "App logs",
    countCreatedAt: "Exported at",
    mode: "Import mode",
    modeReplace: "Replace (recommended)",
    modeReplaceDesc: "Local data is replaced by the backup - like moving the other machine here",
    modeMerge: "Merge",
    modeMergeDesc: "Only adds providers, accounts, routes and aliases you do not have; local settings stay untouched",
    replaceWarning: "Replace copies the current data.json first, then deletes existing providers, accounts and credentials.",
    apply: "Start Import",
    applying: "Importing...",
    applySuccess: "Import complete",
    applySuccessDesc: "Data is written; restart the app to apply it.",
    skipped: "Not imported in merge mode: {{blocks}} (these blocks only land in replace mode)",
    safetyCopy: "data.json copy taken before import: {{path}}",
    later: "Restart Later",
    restartNow: "Restart Now",
    warnNoCredentials: "The backup's accounts carry no credentials; you will need to sign in or enter keys again",
    warnCredentialsUnreadable: "Some credentials could not be decrypted on this machine and were left out",
    warnChannelUnavailable: "The channel runtime was unavailable, so channel login state is not part of this backup",
    warnDifferentPlatform: "The backup comes from another OS; paths and auto-start settings may need adjusting",
    warnNewerAppVersion: "The backup was exported by a newer version; some fields may not be readable here",
    skipStatistics: "statistics",
    skipLogs: "logs",
    skipChannels: "channel login state",
    error: {
      "not-json": "The file is not valid JSON",
      "not-object": "The file content is not a backup object",
      "wrong-format": "Not a ModelPort backup file",
      "unsupported-version": "The backup is newer than this app; upgrade first",
      expired: "This import timed out; pick the file again",
      "storage-not-ready": "Storage is not ready; restart the app and retry",
      "read-failed": "Could not read the file (too large or no permission)",
      "write-failed": "Could not write the file",
      "upload-unavailable": "This gateway has no upload-import route (it predates the feature). Upgrade the gateway, or copy the backup file onto that machine and run node modelport-daemon.cjs --import-backup <path> (password via stdin or MODELPORT_BACKUP_PASSWORD).",
      "desktop-only-restart": "A headless gateway is supervised by systemd, so the page cannot restart it for you: a clean exit under Restart=on-failure is not brought back, which would leave the gateway down. Run systemctl restart modelport on that host.",
      "restart-failed": "The restart request failed.",
      "desktop-only-export": "This gateway runs on a host with no window (WSL / headless daemon), so there is no save dialog and the UI cannot export a backup. Export from the desktop app, or back up that host's data.json directory directly.",
      "bad-password": "Wrong password",
      "apply-failed": "Import failed; the pre-import data.json copy was kept"
    }
  },
  clearCache: "Clear Cache",
  clearing: "Clearing...",
  cacheCleared: "Cache cleared successfully",
  cacheClearFailed: "Failed to clear cache",
  dangerZone: "Danger Zone",
  dangerZoneDesc: "These actions are irreversible, please proceed with caution",
  resetApp: "Reset App",
  resetting: "Resetting...",
  confirmReset: "Confirm Reset",
  confirmResetDesc: "This will clear all settings and data. The application will return to its initial state. This action cannot be undone.",
  resetSuccess: "Application reset successfully. Reloading...",
  resetFailed: "Failed to reset application",
  appName: "ModelPort",
  currentVersion: "Current Version",
  checkUpdates: "Check for Updates",
  checking: "Checking for updates...",
  upToDate: "Current version is up to date",
  updateCheckFailed: "Unable to connect to update server",
  downloadUpdate: "Download Update",
  downloadingUpdate: "Downloading update...",
  updateDownloaded: "Update Downloaded",
  restartAndInstall: "Restart and Install",
  updateAvailable: "Update Available",
  retry: "Retry",
  managementApi: {
    title: "Management API",
    description: "Configure the Management API for programmatic access to platform settings",
    enableToggle: "Enable Management API",
    enableDescription: "When enabled, allows configuration via REST API endpoints",
    secretKey: "Secret Key",
    secretKeyDescription: "Use this key in the Authorization header as Bearer token",
    secretKeyPlaceholder: "No secret key generated",
    copySecret: "Copy",
    showSecret: "Show Secret",
    hideSecret: "Hide Secret",
    generateNew: "Generate New Key",
    generateConfirm: "Are you sure you want to generate a new secret key? The current key will be invalidated.",
    status: "Status",
    enabled: "Enabled",
    disabled: "Disabled",
    apiDocumentation: "API Documentation",
    apiEndpoint: "API Endpoint",
    exampleUsage: "Example Usage",
    warning: "Keep your secret key secure. Do not share it with unauthorized parties."
  }
};
const common = {
  save: "Save",
  cancel: "Cancel",
  "delete": "Delete",
  edit: "Edit",
  add: "Add",
  close: "Close",
  confirm: "Confirm",
  success: "Success",
  error: "Error",
  loading: "Loading...",
  noData: "No data",
  refresh: "Refresh",
  copy: "Copy",
  copied: "Copied",
  yes: "Yes",
  no: "No",
  enabled: "Enabled",
  disabled: "Disabled",
  actions: "Actions",
  details: "Details",
  next: "Next",
  previous: "Previous",
  reset: "Reset"
};
const proxyStatus = {
  start: "Start Proxy",
  stop: "Stop Proxy"
};
const quickActions = {
  title: "Quick Actions",
  addAccount: "Add Account",
  viewLogs: "View Logs"
};
const oauth = {
  validating: "Validating..."
};
const models = {
  title: "Model Management",
  description: "Turn each model or alias in and out of the routing pools; /v1/models advertises routes only",
  modelList: "Model List",
  modelMapping: "Model Mapping",
  metadataTab: "Annotation Coverage",
  annotation: {
    title: "Annotate {{model}}",
    factsSection: "What this source already declares (with provenance)",
    catalogSection: "Complete from third-party standard ledgers",
    markSection: "Manual annotation (highest priority)",
    unavailable: "The main process does not expose single-model metadata; restart the app and try again."
  },
  metadata: {
    batchScopeButton: "Complete this source",
    batchScopeTitle: "Bulk completion: {{scope}}",
    batchScopeDesc: "Only this source is touched; annotations elsewhere stay unchanged. Ledger matching itself sends no requests.",
    batchScopeNone: "Nothing to complete in this scope: the models are disabled or referenced by no enabled route.",
    batchScopeProgressTitle: "Bulk completion for this source",
    batchScopeDone: "Bulk completion finished for this source",
    batchScopeCancelled: "Bulk completion cancelled for this source",
    batchScopeFailedStart: "Bulk completion could not start for this source",
    title: "Model metadata annotation",
    coverageTitle: "Annotation coverage",
    coverageDesc: "Known rows per attribute over the applicable rows (a multiplier does not exist for aggregate and custom rows, so those rows are not a gap); resolution order: manual > upstream declaration > model catalogue > probe > family rule > cost ledger",
    loading: "Aggregating metadata…",
    retry: "Retry",
    refresh: "Refresh",
    unavailable: "Metadata reports are unavailable in this environment",
    totalModels: "Catalogue models",
    routingComplete: "Routing attributes complete",
    routingIncomplete: "Routing attributes missing",
    gapKindAdoptable: "Fillable {{count}}",
    gapKindMissingField: "Catalogue lacks the field {{count}}",
    gapKindNoCandidate: "Not in any catalogue {{count}}",
    gapKindNotChat: "Not a chat model {{count}}",
    gapKindNotChatBadge: "Not a chat model",
    gapKindNoCandidateBadge: "Not in catalogues",
    fullyAnnotatedHint: "all applicable fields set: {{count}}",
    referenceAttribute: "reference",
    notApplicable: "n/a {{count}}",
    referenceOnlyBadge: "reference fields only",
    queueTitle: "Unclassified queue",
    queueDesc: "Sorted by call volume, highest first; attributes with no source stay “unclassified” — nothing is guessed",
    emptyQueue: "Every model has a source for its key attributes",
    queueTruncated: "Showing the {{shown}} most-called of {{total}} models still missing attributes",
    columnModel: "Model",
    columnContext: "Context window",
    columnMaxOutput: "Max output",
    columnMissing: "Missing attributes",
    columnCalls: "Calls",
    columnActions: "Actions",
    probe: "Probe",
    probing: "Probing…",
    probeSuccess: "Probe finished",
    probeFailed: "Probe failed",
    unclassified: "Unclassified",
    attrModelType: "Model type",
    attrVision: "Vision input",
    attrTools: "Tool calls",
    attrReasoning: "Reasoning",
    attrModalities: "Input modalities",
    attrContextTokens: "Context window",
    attrMaxOutputTokens: "Max output",
    attrWeight: "Credit weight",
    attrFree: "Free",
    sourceManual: "Manual",
    sourceUpstream: "Upstream declaration",
    sourceCatalog: "Model catalogue",
    sourceFamilyRule: "Family rule",
    sourceProbe: "Measured",
    sourceCostLedger: "Cost ledger",
    sourceUnclassified: "Unclassified",
    confidenceDeclared: "Declared",
    confidenceInferred: "Inferred",
    confidenceMeasured: "Measured",
    probeDialogTitle: "Probe {{model}}",
    probeDialogDesc: "Requests are sent only after confirmation; one model at a time, with a global concurrency of 1.",
    probeContextScope: "Context window",
    probeOutputScope: "Max output",
    probeCapabilityScope: "Capabilities (tools / images)",
    probeEstimate: "Up to {{requests}} requests · about {{tokens}} tokens",
    probeEstimateSplit: "~{{input}} input · ~{{output}} output tokens",
    probeDeclared: "Declared — no probe needed",
    probeDeclaredSource: "Source: {{source}} (declared)",
    forceProbe: "Force re-probe",
    forceProbeHint: "A re-probe only adds measured evidence; manual marks stay on top",
    probeCancel: "Cancel",
    probeClose: "Close",
    probeStop: "Stop probe",
    probeRetry: "Retry",
    probeCancelled: "Probe cancelled; completed tiers are kept",
    probeElapsed: "{{seconds}}s elapsed",
    probeRequestsSent: "Requests {{sent}}/{{limit}}",
    probePhasePrepare: "Preparing",
    probePhaseTier: "Tier {{index}}/{{count}} · {{tokens}} tokens",
    probePhaseAwaiting: "Awaiting response (tier {{index}}/{{count}})",
    probePhaseDone: "Done",
    probePhaseCancelled: "Cancelled",
    probeErrorNetwork: "Network unreachable (check proxy/network and retry)",
    probeErrorAuth: "Authentication failed (check key or permission)",
    probeErrorRateLimit: "Rate limited (retry later or switch account)",
    probeErrorTimeout: "Upstream timed out (converged as inconclusive; retry is safe)",
    probeErrorUpstream: "Upstream error (5xx; retry is safe)",
    probeErrorUnknown: "Probe failed (retry is safe)",
    batchAll: "Fill all",
    batchViewProgress: "View progress",
    batchProbeToggle: "Probe while filling",
    batchProbeToggleHint: "Off by default; when on, you confirm the total once",
    batchProgressTitle: "Fill-all progress",
    batchPhase_prepare: "Preparing",
    batchPhase_matching: "Matching catalog",
    batchPhase_probing: "Probing",
    batchPhase_backoff: "Backing off",
    batchPhase_done: "Finished",
    batchProcessed: "Processed {{done}}/{{total}} ({{percent}}%)",
    batchCurrentModel: "Current model",
    batchElapsed: "Elapsed {{time}}",
    batchEta: "Est. remaining {{time}}",
    batchSuccess: "Succeeded",
    batchSkippedCount: "Skipped",
    batchFailedCount: "Failed",
    batchAdopted: "{{fields}} fields adopted · {{exact}} exact models · {{alias}} alias models",
    batchAliasAdopted: "Alias matches adopted: {{models}}",
    batchFamilyCandidates: "{{count}} family candidates (not auto-adopted; review only)",
    batchProbeUsage: "Probe requests {{sent}}/{{limit}}",
    batchMeasuredFields: "{{count}} fields measured",
    batchSkippedDisabled: "{{count}} skipped: disabled or not referenced by any route",
    batchBackoff: "Rate limited — backing off {{seconds}}s before continuing",
    batchFailedList: "Failed models",
    batchPause: "Pause",
    batchResume: "Resume",
    batchCancelRun: "Cancel",
    batchRetryFailed: "Retry failed only",
    batchConfirmTitle: "Enable probing: confirm the total",
    batchConfirmDesc: "Catalog filling itself is offline; probing sends real requests through your accounts. After this confirmation nothing else is asked.",
    batchConfirmOnce: "Confirmed once; batches then run automatically until finished.",
    batchConfirmCancel: "Skip probing",
    batchConfirmStart: "Start",
    batchModels: "{{selected}} models",
    batchFields: "{{count}} fields",
    batchMatchBreakdown: "Exact {{exact}} · Alias {{alias}} · Family candidates {{family}}",
    batchProbeModels: "{{count}} models need probing",
    batchDone: "Fill-all finished",
    batchCancelled: "Fill-all cancelled",
    batchFailed: "Fill-all could not start",
    batchNoTargets: "No models need filling",
    batchSummary: "Succeeded {{success}} · Skipped {{skipped}} · Failed {{failed}}",
    batchStatus_matching: "Matching",
    batchStatus_probing: "Probing",
    batchStatus_done: "Done",
    batchStatus_partial: "Partially done",
    batchStatus_skipped: "Skipped",
    batchStatus_failed: "Failed",
    batchPausedLabel: "Paused",
    catalogSourceError: "This source failed: {{error}} (other sources and the previous snapshot are unaffected)",
    catalogBuiltinBadge: "Built-in snapshot ({{date}})",
    catalogBuiltinFetchedAt: "Built-in snapshot date: {{date}}",
    catalogUsingBuiltin: "Using the built-in snapshot ({{date}})",
    catalogEndpointAttempts: "Endpoint attempts",
    catalogEndpoint_primary: "Primary",
    catalogEndpoint_jsdelivr: "jsDelivr",
    catalogEndpoint_mirror: "Custom mirror",
    catalogEndpointFailed: "Failed",
    catalogErrorKind_network: "Network unreachable",
    catalogErrorKind_timeout: "Timed out",
    catalogErrorKind_http: "HTTP error",
    catalogErrorKind_parse: "Parse failed",
    catalogErrorKind_empty: "No usable entries",
    catalogErrorKind_unknown: "Unknown error",
    catalogMirrorSave: "Save mirror",
    catalogMirrorSaved: "Mirror URL saved",
    catalogMirrorInvalid: "Invalid mirror URL (https only)",
    catalogMirrorHint: "Optional, https only; reachability and trust are your responsibility. Leave empty to disable.",
    probeStatusMeasured: "Measured range",
    probeStatusInconclusive: "Inconclusive (upstream gave no judgeable failure)",
    probeStatusSuspect: "Suspected silent truncation",
    probeStatusDeferred: "Deferred (local concurrency or quota)",
    probeStatusSkipped: "Declared — skipped",
    probeRangeLabel: "Measured range: {{range}}",
    probeReasonLabel: "Reason: {{reason}}",
    probeRequests: "{{count}} requests",
    probeTokens: "about {{tokens}} tokens",
    probeNoPlan: "No probe tiers available",
    catalogTitle: "Standard model catalogue snapshots",
    catalogDesc: "Third-party catalogues are stored locally as snapshots; opening this page never goes online, and a refresh only happens when you click. A failed refresh keeps the previous snapshot.",
    catalogReady: "{{count}} entries",
    catalogNotFetched: "Not fetched yet",
    catalogRefresh: "Refresh snapshot",
    catalogRefreshing: "Refreshing…",
    catalogFetchedAt: "Fetched at: {{time}}",
    catalogLicense: "License: {{license}}",
    catalogAttribution: "Attribution: {{attribution}}",
    catalogHash: "Content hash: {{hash}}",
    catalogLicenseNotice: "The standard catalogue is third-party data kept for reference; prices are shown in USD per 1M tokens and never feed routing, quota or weight calculations, nor the generated pricing sidecars.",
    annotate: "Annotate",
    catalogDialogTitle: "Fill {{model}} from the standard catalogue",
    catalogDialogDesc: "Candidates are ranked exact id → normalized alias → family and are never adopted automatically; adopt each field individually and revoke at any time.",
    catalogLoading: "Matching the standard catalogue…",
    catalogFailed: "Catalogue operation failed",
    catalogNoMatches: "No entry in the current snapshot matches this model; refresh the snapshot first, or the model is genuinely absent from the standard catalogues.",
    catalogFieldAbsent: "This catalogue entry carries no value for the field, so it cannot be adopted.",
    catalogSourcesNotFetched: "Not fetched: {{sources}}. The bundled LiteLLM table has no Reasoning values and only partial Input modalities; refresh these sources in the standard-library card above, or use manual marks / a probe instead.",
    catalogConfidenceExact: "Exact id",
    catalogConfidenceAlias: "Alias",
    catalogConfidenceFamily: "Family",
    catalogConfidenceFuzzy: "Fuzzy match",
    catalogFieldPrice: "Price (reference)",
    catalogPriceHint: "Display only — never used for routing or quota",
    catalogYes: "Yes",
    catalogNo: "No",
    catalogAdopt: "Adopt",
    catalogAdopted: "Adopted",
    catalogAdoptedBadge: "Adopted",
    catalogAdoptedTitle: "Adopted fields",
    catalogAdoptedOther: "Currently adopted from {{id}}",
    catalogRevoke: "Revoke",
    catalogRevokeAll: "Revoke all",
    catalogRevoked: "Revoked — back to the automatic resolution",
    catalogRefreshDone: "Catalogue snapshot updated",
    catalogRefreshFailed: "Catalogue refresh failed",
    catalogKeptOld: "previous snapshot kept"
  },
  modelName: "Model Name",
  provider: "Provider",
  account: "Account",
  status: "Status",
  available: "Available",
  unavailable: "Unavailable",
  searchModels: "Search models...",
  allProviders: "All Providers",
  allTypes: "All Types",
  typeMultimodal: "Multimodal",
  typeText: "Text",
  typeUnknown: "Unknown (not declared)",
  allCosts: "All Costs",
  allServeStates: "All states",
  servedOnly: "Enabled",
  stoppedOnly: "Disabled",
  costFreeOnly: "Free",
  costBelowBase: "Below base (<1×)",
  costBase: "At base (1×)",
  costAboveBase: "Above base (>1×)",
  costUnknown: "No multiplier reported",
  free: "Free",
  multimodal: "Multimodal",
  modalityHint: "Modality comes from the channel catalogue/adapter declaration; undeclared models stay unknown — nothing is inferred",
  costHint: "Bucketed by credit multiplier; the 1× base comes from the channel catalogue label. A model with no reported multiplier and no free marker gets its own bucket instead of being folded into any paid one",
  providerCredits: "Provider credits",
  weightUnknownHint: "The channel reports no multiplier for this model, so it cannot be bucketed by cost",
  stopped: "Disabled",
  serveToggle: "Whether this model joins the routing pools",
  serveOnlySelected: "Enable Only Selected",
  serveOnlyDone: "Routing pool updated",
  serveOnlyDoneDesc: "Kept {{count}} models in the routing pools; the rest are out",
  serveChangeFailed: "Failed to change the enabled state",
  servedOfTotal: "{{served}} of {{total}} models in the routing pools",
  selectAll: "Select All",
  copySelected: "Copy Selected",
  copyAll: "Copy All",
  totalModels: "{{count}} models total",
  selectedModels: "{{count}} models selected",
  noModelsFound: "No models found",
  noModelsDesc: "Please add providers and accounts first",
  noMatchDesc: "No models match these filters — try relaxing the type or cost filter",
  copySuccess: "Copied",
  copySuccessDesc: "{{count}} model names copied to clipboard",
  pageInfo: "Page {{current}} / {{total}}"
};
const modelEditor = {
  title: "Model Management - {{name}}",
  defaultModels: "Default Models",
  customModels: "Custom Models",
  displayName: "Display Name",
  fromOnlineSync: "Online sync",
  actualModelId: "Actual Model ID",
  actions: "Actions",
  addModel: "Add Model",
  resetDefault: "Reset to Default",
  cancel: "Cancel",
  noModels: "No models",
  warningMessage: "The actual model ID must be obtained from the provider's official page. Incorrect ID will cause chat failures. Please confirm the model ID on the official page before adding.",
  addDialogTitle: "Add Custom Model",
  displayNameLabel: "Model Display Name",
  displayNamePlaceholder: "e.g., My-Custom-Model",
  displayNameHelp: "Model name used by AI client",
  actualIdLabel: "Actual Model ID",
  actualIdPlaceholder: "e.g., deepseek-chat",
  actualIdHelp: "Model identifier used by API",
  add: "Add",
  nameRequired: "Model display name is required",
  idRequired: "Actual model ID is required",
  nameExists: "Model display name already exists",
  addSuccess: "Model added successfully",
  addError: "Failed to add model",
  removeSuccess: "Model removed successfully",
  removeError: "Failed to remove model",
  resetSuccess: "Models reset to default",
  resetError: "Failed to reset models",
  confirmReset: "Are you sure you want to reset to default? This will remove all custom models and exclusion settings.",
  confirmDelete: "Are you sure you want to delete this model?"
};
const about = {
  tagline: "Multi-platform AI Service Unified Management Tool",
  links: "Links",
  github: "GitHub Repository",
  releases: "Releases",
  reportIssue: "Report Issue",
  appUpdates: "Application Updates",
  shellUpdateTitle: "Online upgrade (Shell + gateway)",
  shellUpdateDesc: "The Shell upgrades itself and, when the gateway is marked as WSL-managed, upgrades the WSL daemon too. Every downloaded artifact is verified against its SHA-256.",
  gatewayRemoteTitle: "Gateway updates",
  gatewayRemoteDesc: "This page is hosted by a remote gateway, so there is no local Shell updater. Upgrade the gateway with the tarball on its host, and reinstall the Shell from its installer.",
  shellVersion: "Shell version",
  gatewayVersion: "Gateway version",
  gatewayUnmanaged: "This gateway is not marked as WSL-managed; only the Shell can be upgraded. Upgrade a remote gateway on its host.",
  daemonReadFailed: "Could not read the gateway version",
  updateAvailable: "Update available",
  missingAssets: "Missing installer or checksum",
  upgradeAll: "Upgrade",
  upgradeDone: "Upgrade complete",
  upgradeFailed: "Upgrade failed",
  openReleasePage: "Open release page",
  stages: {
    checking: "Checking for updates",
    "downloading-daemon": "Downloading daemon",
    "verifying-daemon": "Verifying daemon",
    "installing-daemon": "Installing daemon",
    "restarting-daemon": "Restarting gateway",
    "downloading-shell": "Downloading Shell",
    "verifying-shell": "Verifying Shell",
    "installing-shell": "Installing Shell",
    done: "Done",
    error: "Failed"
  },
  credits: "Made with ❤️ by the Open Source Community",
  builtWith: "Built with Electron, React, TypeScript, Tailwind CSS, Zustand, Koa and other amazing open source projects."
};
const session = {
  sessionSettings: "Session Settings",
  deleteAfterChat: "Chat History Cleanup",
  deleteAfterChatHint: "Automatically delete web-side chat history after each conversation",
  configSaved: "Session configuration saved",
  configSaveFailed: "Failed to save session configuration"
};
const compression = {
  title: "Context compression",
  loading: "Reading the current settings… (no switch until the stored value arrives, so a default can never be saved as if it were the user's choice)",
  enable: "Enable context compression",
  enableHint: "Compresses only the newest turn (tool output and user input) and leaves all history bytes untouched, so the upstream prompt cache is preserved. With it off, requests are byte-for-byte unchanged.",
  aggressiveness: "Strength",
  aggressivenessHint: "Stronger settings keep fewer rows. Error rows, statistical outliers and numeric anomalies are never dropped at any strength.",
  cacheFirst: "Cache first (skip compression for cache-friendly providers)",
  cacheFirstHint: "A compressed block is discarded by the next turn's original bytes, so on providers whose cached input is much cheaper than fresh input (DeepSeek, Anthropic) compression usually costs more than it saves. This policy skips it unless a per-provider override says otherwise.",
  level: {
    conservative: "Conservative",
    moderate: "Moderate",
    aggressive: "Aggressive"
  },
  configSaved: "Compression settings saved",
  configSaveFailed: "Failed to save compression settings"
};
const promptCaching = {
  title: "Prompt cache",
  loading: "Reading the current settings…",
  enable: "Place Anthropic cache breakpoints",
  enableHint: "Adds cache_control markers to Anthropic-format requests (tool list, system prompt, previous turn). Metadata only — no text is changed. Implicit-cache providers such as DeepSeek need no marker and are unaffected.",
  ttl: "Cache lifetime",
  ttlHint: "5 minutes is the default tier. 1 hour costs more to write but survives longer gaps; it is only sent to endpoints that support explicit breakpoints.",
  ttlOption: {
    "5m": "5 minutes",
    "1h": "1 hour"
  },
  note: "Anthropic-format endpoints only. DeepSeek and other implicit-prefix providers cache automatically; their hit rate is governed by prefix stability and account/model affinity, not this switch.",
  configSaved: "Prompt cache settings saved",
  configSaveFailed: "Failed to save prompt cache settings"
};
const anthropicInbound = {
  title: "Anthropic clients (Claude Desktop / Claude Code)",
  loading: "Loading…",
  documentPassThrough: "Send attached files upstream",
  documentPassThroughHint: "Anthropic `document` blocks become OpenAI-compatible `file` parts and really reach the upstream. On (the default) means a model that cannot read files fails loudly instead of answering as though nothing was attached - and because an attachment counts as a vision need, such a request only routes to candidates marked vision-capable. Off drops the block but records it in X-ModelPort-Anthropic-Dropped plus a warning log. The switch is read by proxy/routes/messages.ts.",
  defaultModel: "Fallback model",
  defaultModelHint: "Where a request lands when the model name the client sent cannot be resolved in the gateway. Leave it empty to use the gateway default: the `auto` route, or the first enabled route when there is no `auto`.",
  mappings: "Model name mapping",
  mappingsHint: "Name sent by the client (exact name or prefix) → gateway model. Exact keys take precedence over prefixes.",
  noMappings: "No mapping yet: a name the gateway does not recognize falls through to the fallback model above.",
  clientName: "Name sent by the client",
  gatewayModel: "Gateway model",
  addMapping: "Add mapping",
  remove: "Remove mapping",
  discoveryTitle: "Names Anthropic clients can discover",
  discoveryHint: "Claude Desktop and Claude Code keep only model IDs starting with claude or anthropic when they read /v1/models, so a real Claude model advertised as <entry>/<model> disappears from the client. /v1/models advertises routes only, so this creates one route per such model, named by the Anthropic ID already in the gateway's data, with its candidate pool pinned to the entries that actually serve it — never an invented name, never a route free to answer with any model. This section only serves installs whose catalogue really contains a Claude-shaped model; when none exists the section is not rendered at all, and the tier list above is the way in.",
  discoveryPreview: "Preview",
  discoveryApply: "Create routes",
  discoveryError: "Discovery failed: {{message}}",
  discoveryCreate: "Would create {{total}} route(s):",
  discoveryAlready: "{{total}} name(s) are already discoverable:",
  discoverySkipped: "{{total}} name(s) skipped, each with its reason:",
  discoveryApplied: "Created {{total}} route(s)",
  discoveryFailed: "{{total}} route(s) could not be created; the ones already created stay in place:",
  discoveryNothingNew: "Nothing to create: every discoverable name already has a route.",
  discoveryAlsoServedBy: "pool also includes {{names}}",
  discoveryReason: {
    "no-active-account": "that provider has no active account, so the name would be dead on arrival",
    "already-visible": "a model with that name already exists",
    "mapping-exists": "an alias owns that name, and a route may not collide with one",
    "route-name-taken": "a route with that name already exists",
    "name-not-routable": "the Anthropic ID contains a dot or a slash, which route names cannot carry (the name goes into the X-ModelPort-Route-Name header) - use Model Mapping to point it at a route"
  },
  duplicateNames: "Repeated client name: {{names}} — only the last row takes effect.",
  discoveryNote: "A row whose left-hand name is a complete model name is also advertised on /v1/models, so the client can pick it from its own list. A prefix-only key (for example `claude-`) is used for matching but can never appear in that list, because the client filters every row against Anthropic's own model-name table.",
  tierTitle: "Advertise routes by Anthropic family tier",
  tierHint: "Claude Desktop keeps a row when its id is a model name it knows, or when the row carries a legal family tier. So tagging an existing route with a tier advertises it without inventing Anthropic names; the client sends that route name back and the request lands in that route's own pool. That covers discovery only: its model picker re-filters by name and a tier does not count there, so the rows it cannot select are listed below.",
  tierNoRoutes: "No enabled routes: enable one on the Routes page first.",
  tierColumn: "Tier",
  routeColumn: "Route name (this is what the client filters on)",
  surfaceLead: 'Two tables, two jobs: "client name -> gateway route" decides which names appear in Claude and which route each one runs; "advertise routes by Anthropic family tier" decides which family a route stands in for, and its last column states the outcome. The client only trusts names - a route whose name is not Anthropic-shaped is discoverable but not selectable.',
  outcomeColumn: "Result in Claude",
  outcomeSelectable: "Listed and selectable: {{name}}",
  outcomeNeedsName: "Discovered but not selectable today - saving renames it to {{name}}",
  outcomeNotAdvertised: "Never listed: no tier, and {{name}} is not an Anthropic-shaped name",
  tierNone: "Not advertised",
  tier_sonnet: "sonnet (everyday efficiency)",
  tier_opus: "opus (most capable)",
  tier_haiku: "haiku (fastest)",
  tier_fable: "fable (hardest tasks)",
  tier_mythos: "mythos",
  pickerGapAuto: "Saving appends these to the mapping table above: {{pairs}} (names are claude-<tier> with no version number, so nothing pretends to be a specific Anthropic release; edit or delete them there)",
  pickerGapBlocked: "No free name could be generated for: {{names}} — rename those routes yourself",
  pickerGapFix: "To choose different names, rename the routes instead (for example claude-daily) - each row restates its outcome afterwards.",
  configSaved: "Anthropic inbound settings saved",
  configSaveFailed: "Failed to save Anthropic inbound settings"
};
const contextManagement = {
  title: "Context Management",
  enableContextManagement: "Enable Context Management",
  enableContextManagementHint: "Automatically manage conversation context to prevent exceeding model limits",
  strategyConfig: "Strategy Configuration",
  configSaved: "Context management configuration saved",
  configSaveFailed: "Failed to save context management configuration",
  slidingWindow: {
    title: "Context Count",
    description: "Keep recent N messages, always preserve system messages",
    maxMessages: "Max Messages",
    maxMessagesHint: "Maximum number of messages to keep (1-100)"
  },
  tokenLimit: {
    title: "Max Tokens",
    description: "Truncate history by token count, always preserve system messages",
    maxTokens: "Max Tokens",
    maxTokensHint: "Maximum number of tokens to keep (100-100000)"
  }
};
const aggregate = {
  title: "Aggregate Channels",
  description: "Standard key-based endpoints and key-less free pools. Add a channel to turn it into a provider; models are exposed as provider/model.",
  allCategories: "All categories",
  category: {
    apikey: "API Key",
    freeTier: "Free Tier",
    local: "Local"
  },
  columnQuota: "Free quota",
  quotaFreePool: "Free pool",
  quotaUsage: "{{metric}} used {{used}}/{{limit}} ({{window}})",
  quotaScopeNote: "Vendor scope:",
  window: {
    minute: "last minute in this app",
    day: "rolling 24h in this app",
    month: "UTC calendar month in this app"
  },
  quotaSource: "cap source (verified {{date}})",
  quotaContext: "context {{tokens}}",
  quota: {
    "needs-key": "No key - nothing to meter",
    exhausted: "At the documented cap",
    documented: "Documented cap",
    undocumented: "No published cap",
    absent: "Quota not recorded"
  },
  metric: {
    rpm: "req/min",
    rpd: "req/day",
    tpm: "tok/min",
    tpd: "tok/day",
    monthlyTokens: "tok/mo"
  },
  notConfigured: "Not configured",
  active: "Active",
  disabled: "Disabled",
  unsupported: "Unsupported auth",
  termsWarningAll: "Terms: this endpoint is a subscription coding plan for interactive use in the vendor's approved tools; calls made from this app fall outside the permitted scope",
  termsWarningFreeOnly: "Terms: free-tier models require the OpenCode client; paid models and OpenCode Go may be used from other clients",
  termsWarningSource: "clause text (verified {{date}})",
  deleteConfirm: "Remove {{name}} and its accounts?",
  dialog: {
    apiKeys: "API Keys (multiple allowed)",
    apiKeyPlaceholder: "One API key per line",
    apiKeysHint: "One key per line. With multiple keys, calls to this provider's models rotate over them and a rate-limited key falls through to the next.",
    baseUrl: "Base URL",
    baseUrlHint: "Required when the catalogue has no usable default (placeholders are not expanded).",
    models: "Models",
    paramsEdit: "Params",
    paramsApply: "Apply",
    paramsClear: "Clear",
    paramsExtra: "Other parameters (JSON)",
    paramsInvalid: "Invalid parameters: numeric fields must be numbers and other parameters must be a JSON object",
    enabled: "Enabled"
  },
  result: {
    saved: "Saved {{name}}",
    removed: "Removed {{name}}"
  },
  reasons: {
    unknown: "Unknown error",
    unknown_entry: "Unknown catalogue entry",
    unsupported_auth: "This endpoint needs an auth this app cannot produce",
    missing_base_url: "Base URL is required",
    placeholder_base_url: "Base URL still contains placeholders",
    invalid_base_url: "Base URL must start with http:// or https://",
    missing_api_key: "API key is required",
    invalid_api_key: "Every stored key was rejected by the endpoint",
    not_configured: "Add the provider first",
    no_model_list: "This endpoint does not list models",
    http_status: "The endpoint rejected the request",
    empty: "The endpoint returned no models",
    unrecognized_shape: "Unrecognised model list payload",
    network_error: "Network error",
    save_failed: "Could not save the discovered models",
    unknown_account: "Account not found",
    unknown_model: "This model is not in the catalogue",
    missing_model: "A model id is required",
    last_model: "At least one model must remain",
    keyless_entry: "This endpoint needs no key"
  },
  manage: {
    search: "Search providers",
    sectionEnabled: "Enabled",
    sectionDisabled: "Disabled",
    sectionAvailable: "Not added",
    modelCount: "{{count}} models",
    keyCount: "{{count}} keys",
    noMatch: "No provider matches",
    wireChat: "OpenAI compatible",
    wireAnthropic: "Anthropic compatible",
    remove: "Remove provider",
    notConfiguredHint: "This provider is not in the aggregate channel yet. Save an endpoint and key to expose its models as provider/model.",
    setup: {
      title: "Add to aggregate channel",
      modelsHint: "One upstream model id per line; leave empty to use the catalogue.",
      submit: "Save and add"
    },
    keys: {
      title: "API Keys",
      keyless: "This endpoint needs no key - save it and it works.",
      empty: "No keys stored",
      placeholder: "Paste an API key and press Enter",
      add: "Add",
      hint: "Each key is checked against the model list before it is stored; a rejected key is never saved. With several keys, requests rotate across them.",
      added: "Key added",
      rejected: "Key rejected: {{message}}",
      validate: "Recheck",
      valid: "Key works",
      "delete": "Delete",
      statusError: "Check failed",
      lastUsed: "Last used {{time}}"
    },
    endpoint: {
      title: "Endpoint",
      chatPath: "Chat path",
      save: "Save endpoint",
      reset: "Reset to default",
      saved: "Endpoint saved",
      invalid: "The endpoint must start with http:// or https://"
    },
    quota: {
      title: "Free quota",
      none: "No published cap; usage is metered locally.",
      notKeyed: "No key, so usage cannot be metered."
    },
    credit: {
      title: "Live credit (asked from the vendor, not metered here)",
      query: "Query live credit",
      querying: "Querying…",
      needsKey: "This entry has no stored key, so there is no credential to query with.",
      hint: "One click sends one GET {{path}}. Nothing is polled and opening the page never asks by itself.",
      never: "Never queried for this entry.",
      unlimited: 'This key reports no credit cap - neither 0 nor "plenty left".',
      remaining: "{{remaining}} {{unit}} left",
      remainingWithLimit: "{{remaining}} of {{limit}} {{unit}} left",
      limitOnly: "Cap {{limit}} {{unit}}, no balance reported",
      at: "read at {{time}}",
      orderingOn: "Fresh (within {{minutes}} min), so it counts toward candidate ordering.",
      orderingOff: "Expired (older than {{minutes}} min): shown verbatim, no longer used for ordering. Click once to refresh.",
      perKey: "{{name}} · {{maskedKey}}",
      skippedKeys: "{{n}} further key(s) not queried",
      endpoint: "Credit endpoint: {{path}} (source: {{doc}})",
      lastFail: "Last attempt ({{time}}) did not yield a balance: {{detail}}",
      failHttpStatus: "Upstream refused the query",
      failNotJson: "The credit endpoint did not answer with JSON",
      failShape: "Response shape not recognised - nothing was guessed",
      failNetwork: "Network error while querying",
      failDetail: "{{label}}: {{detail}}",
      failure: {
        unknown_entry: "Catalogue entry not found.",
        no_probe: "This entry has no credit endpoint declared, so nothing was asked.",
        not_configured: "The provider record is missing, so there is nothing to query.",
        missing_api_key: "No stored key to query with."
      },
      reason: {
        "http-status": "upstream status",
        "not-json": "not JSON",
        "unexpected-shape": "unrecognised shape",
        network: "network error"
      }
    },
    models: {
      annotate: "Annotate",
      annotateHint: "Review what this source declares and complete it field by field from the third-party ledgers",
      title: "Models",
      count: "{{total}} models · {{served}} enabled",
      search: "Search models",
      empty: "No models yet - use Add model or Sync models.",
      sync: "Sync models",
      syncHint: "Fetch the upstream /models list and merge new models in (add-only)",
      add: "Add model",
      test: "Test this model",
      testAll: "Test all",
      testing: "Testing…",
      "delete": "Delete this model",
      expand: "Expand",
      collapse: "Collapse",
      expandAll: "Expand all",
      collapseAll: "Collapse all",
      testOk: "{{latency}} ms",
      testFailed: "Failed",
      sourceBuiltin: "Catalogue",
      sourceFetched: "Synced",
      sourceCustom: "Manual",
      groupToggle: "Enable/disable this group",
      costTitle: "Cost",
      costFree: "Free",
      costIncluded: "In plan",
      costPriced: "Metered",
      costUnknown: "Unlabelled",
      costFreeOfficial: "Free (vendor-declared)",
      costFreeCatalogue: "Free (catalogue)",
      costFreeThirdParty: "Free (third-party price)",
      costFreeOfficialHint: "The vendor's own documentation names this model as free",
      costFreeCatalogueHint: "The catalogue copied this free entry from an upstream registry, with no separate official source",
      costFreeThirdPartyHint: "A third-party catalogue (models.dev) lists this at zero price; the vendor does not name it free",
      costIncludedHint: "This allowance is already inside a subscription plan, so the marginal price is 0. It stops when the plan allowance runs out - not free unlimited use.",
      costPricedHint: "Metered unit price from a third-party catalogue (USD per million tokens). This is an absolute price, not a consumption multiplier.",
      costUnknownHint: "No free marker and no verifiable price - neither free nor paid is known.",
      costSource: "Source: {{source}} ({{asOf}})",
      costFilter: "Cost",
      costFilterAll: "All cost classes",
      costSummary: "{{free}} free · {{included}} in plan · {{priced}} metered · {{unknown}} unlabelled",
      costPriceLabel: "{{input}} / {{output}} USD per million tokens (input / output)"
    },
    modelAdd: {
      title: "Add model",
      id: "Upstream model id",
      placeholder: "e.g. gpt-4o-mini",
      hint: "Enter the real upstream model id; it is exposed as {{prefix}}/<id>.",
      submit: "Add"
    },
    modelParams: {
      title: "Model parameters · {{model}}",
      hint: "Configured values override the client's same-named fields (model / messages / stream cannot be overridden)."
    },
    toast: {
      saved: "Saved",
      removed: "Deleted",
      modelRemoved: "Deleted model {{model}}",
      tested: "Tests finished: {{ok}} working, {{failed}} failed",
      testing: "Testing {{count}} models…",
      synced: "Sync finished: {{fetched}} upstream, {{added}} new, {{total}} total",
      syncedNoChange: "Every upstream model is already listed; nothing new",
      syncedFromModelsDev: "The upstream list endpoint answered nothing usable, so this sync used the models.dev catalogue instead (it may lag slightly behind upstream)"
    }
  }
};
const channels = {
  title: "Account Channels",
  description: "Sign in to third-party coding assistants and pool their free quotas. {{connected}} of {{total}} channels connected.",
  connected: "Connected",
  notConnected: "Not connected",
  statAccounts: "Accounts",
  statModels: "Models",
  statCredits: "Credits",
  creditsReported: "{{reported}}/{{total}} accounts answered",
  creditsDisabled: "disabled",
  addAccount: "Add account",
  claim: "Claim credits",
  claimDone: "Credits claimed",
  claimSummary: "New {{claimed}}, already claimed {{already}}, failed {{failed}}, +{{total}} total",
  claimFailed: "Could not claim credits",
  device: {
    button: "Device ID",
    title: "Check-in device ID for {{name}}",
    hint: "TRAE only accepts a 16-digit device ID that the official client registered; a self-generated value is rejected upstream (9074).",
    label: "16-digit device ID",
    placeholder: "e.g. 2235123456787879",
    reading: "Reading the device ID of the official client on this machine…",
    detected: "Device IDs found on this machine — click to fill in:",
    none: "No device ID found in the official client's storage.json. Sign in to the TRAE client on this machine first, or type one manually.",
    where: "Location: keys of the form iCubeAuthInfo://icube-dc:<16 digits> in %APPDATA%\\Trae CN\\User\\globalStorage\\storage.json. Each sign-in session leaves one.",
    save: "Save device ID",
    saved: "Device ID saved",
    savedHint: "The next check-in for {{name}} will use this device ID",
    invalid: "A device ID must be 16 digits",
    readFailed: "Could not read device IDs",
    saveFailed: "Could not save the device ID"
  },
  claimTasks: "Claim task credits",
  claimTasksDone: "Task credits claimed",
  claimTasksError: "Could not claim task credits",
  claimTasksNothing: "No task reward to claim",
  claimTasksGainsCredit: "+{{credit}} credits",
  claimTasksGainsEnergy: "+{{energy}} energy",
  claimTasksClaimed: "Claimed {{count}} task(s)",
  claimTasksClaimedWithGains: "Claimed {{count}} task(s) ({{gains}})",
  claimTasksAlready: "{{count}} already claimed",
  claimTasksNotClaimable: "{{count}} not completed yet",
  claimTasksFailed: "{{count}} task(s) failed",
  claimTasksErrors: "{{count}} account(s) returned no result",
  listSeparator: ", ",
  tasks: {
    accept: "Accept tasks",
    list: "Task list",
    acceptDone: "Tasks accepted",
    acceptError: "Could not accept tasks",
    accepted: "Accepted {{count}} task(s)",
    untouched: "{{count}} need no accepting",
    acceptErrors: "{{count}} account(s) returned no result",
    acceptNote: "They will complete as you keep using the app",
    acceptNothing: "No task needs accepting",
    readFailed: "Could not read the task list",
    copyTerm: 'Copy "{{term}}"',
    copied: "Copied",
    copyFailed: "Could not copy (clipboard blocked — select it manually)",
    gainsBuddy: "Limited Buddy",
    status: {
      not_accepted: "Not accepted",
      accepted: "Accepted",
      in_progress: "In progress",
      completed: "Ready to claim",
      claimed: "Claimed"
    }
  },
  autoCheckin: {
    title: "Auto-claim daily credits",
    description: "Claim the check-in credits of every account on every connected channel once a day; channels that failed or have not refreshed yet are retried until the day is complete.",
    on: "On",
    off: "Off",
    running: "Claiming…",
    pending: "{{count}} channel(s) still unfinished today — retrying automatically",
    ranToday: "Already claimed today ({{date}})",
    last: "Last run: {{result}} · {{time}}",
    channelLine: "{{name}}: {{status}}",
    never: "Never ran yet",
    unavailable: "The channel runtime is not running, so this switch cannot be read"
  },
  autoGrowth: {
    title: "Auto-claim completed growth tasks",
    description: "Once a day, claim growth-task rewards that are already completed but unclaimed (claim only, never accept). Tasks you have not finished stay for you to do in the client. Off by default.",
    on: "On",
    off: "Off",
    running: "Claiming…",
    pending: "{{count}} channel(s) failed today — retrying automatically",
    ranToday: "Already claimed today ({{date}})",
    last: "Last run: {{result}} · {{time}}",
    never: "Never ran yet",
    unavailable: "The channel runtime is not running, so this switch cannot be read"
  },
  models: {
    annotate: "Annotate",
    annotateHint: "Review what the channel declares and complete it field by field from the third-party ledgers",
    annotateBlocked: "This model is disabled or dead, so it is not in the provider catalogue and cannot be annotated",
    title: "Models",
    refresh: "Refresh online",
    refreshed: "Models updated",
    refreshedCount: "{{count}} models available",
    refreshFailed: "Could not refresh the model list",
    updateFailed: "Could not update the model",
    disableModel: "Turn this model off",
    enableModel: "Turn this model on",
    restoreModel: "Show it again",
    restored: "Dead model restored",
    restoredCount: "{{count}} model(s) restored",
    free: "Free",
    disabled: "Off",
    dead: "Dead",
    empty: "No models yet — add an account, then refresh online",
    source: {
      badgeCache: "Catalog: local cache",
      badgeFallback: "Catalog: built-in fallback",
      noticeCache: "The vendor's model API has changed or is currently unavailable. This catalogue comes from the local official client cache rather than a live upstream call, so it may lag the vendor slightly. Chat still uses these models.",
      noticeFallback: "The vendor's model API has changed or is currently unavailable, and the local official client cache is unreadable. The built-in fallback catalogue is shown; it may miss new models or include retired ones.",
      toastCache: "Catalogue from the official client cache (upstream returned no usable list)",
      toastFallback: "Catalogue from the built-in fallback (upstream returned no usable list)"
    }
  },
  refreshAccount: "Refresh credentials",
  identityRisk: {
    high: "Identity risk: high",
    medium: "Identity risk: medium",
    low: "Identity risk: low"
  },
  identityRiskTooltip: "This channel presents a first-party client identity upstream: {{declared}}. Vendor clients keep changing versions, and the account may be stopped for non-official usage.",
  identityLive: {
    title: "Live identity",
    source: {
      env: "User-pinned",
      official: "Official API",
      "local-install": "Local install",
      fallback: "Built-in fallback"
    },
    checkedAt: "checked {{time}}",
    badge: {
      fresh: "tracks official",
      stale: "fallback, may be stale"
    },
    badgeTooltip: "Requests currently carry v{{version}} ({{source}}, checked {{time}}). {{state}}",
    badgeState: {
      fresh: "The value comes from the official API / local install / user pin, and follows vendor client upgrades automatically.",
      stale: "The value comes from a built-in constant (official API and local install both unavailable); it may lag behind the current official release."
    }
  },
  serviceStopped: "Stopped by upstream",
  refreshedAccount: "Credentials refreshed",
  refreshAccountFailed: "Could not refresh credentials",
  moveUp: "Move up",
  moveDown: "Move down",
  reorderFailed: "Could not reorder accounts",
  removeConfirm: "Remove every account of {{name}}?",
  removed: "Removed {{name}}",
  loginKind: {
    browser: "Browser login",
    "device-code": "Device code",
    sms: "SMS verification",
    oauth: "OAuth",
    "api-key": "Paste an API key"
  },
  login: {
    title: "Sign in to {{name}}",
    starting: "Opening the sign-in page…",
    waiting: "Waiting for you to finish signing in…",
    success: "Account added",
    failed: "Sign-in failed",
    timeout: "Sign-in timed out, please retry",
    hint: {
      browser: "The authorisation page was opened in your system browser. This page updates as soon as you finish.",
      "device-code": "Finish the device authorisation in the page that opened. This page updates automatically.",
      sms: "Complete the SMS verification in the page that opened. This page updates automatically.",
      oauth: "The authorisation page was opened in your system browser. This page updates once you approve.",
      "api-key": "This channel opens no browser: add an anonymous slot to use the free lane without a credential, or paste your own API key to unlock paid models."
    }
  },
  credential: {
    title: "Add an account to {{name}}",
    hint: "This channel opens no browser: add an anonymous slot to use the free lane, or paste your own API key to unlock paid models.",
    keyLabel: "API key",
    keyPlaceholder: "sk-… (created at opencode.ai/auth)",
    nicknameLabel: "Label (optional)",
    nicknamePlaceholder: "e.g. main",
    addKey: "Add with this key",
    addAnonymous: "Add an anonymous slot",
    anonymousHint: "Anonymous slots need no credential but are capped per source IP; when the allowance runs out, every slot on the same exit fails together.",
    addedKey: "API key account added",
    addedAnonymous: "Anonymous channel added",
    keyRequired: "Enter an API key first, or use “Add an anonymous slot”.",
    failed: "Could not add the account",
    misconfigured: "This channel declares no add-account method, so the UI cannot add one."
  }
};
const connect = {
  title: "Connect to ModelPort gateway",
  subtitle: "This page is the management UI; the gateway itself runs as a headless service.",
  secretLabel: "Management secret",
  submit: "Connect",
  connecting: "Connecting…",
  unauthorized: "The gateway rejected this management secret.",
  unreachable: "Cannot reach the gateway: {{message}}",
  daemonKeepsRunning: "Closing this tab does not stop the gateway; it keeps serving requests.",
  retrieving: "Retrieving this gateway's secret from the system keystore...",
  remembered: "In this shell, an accepted secret is stored in the system keystore (only the current Windows user can decrypt it). After moving to another machine or account it asks once more."
};
const enUS = {
  header,
  nav,
  dashboard,
  providers,
  proxy,
  gateways,
  apiKeys,
  logs,
  settings,
  common,
  proxyStatus,
  quickActions,
  oauth,
  models,
  modelEditor,
  about,
  session,
  compression,
  promptCaching,
  anthropicInbound,
  contextManagement,
  aggregate,
  channels,
  connect
};
const resources = {
  "zh-CN": {
    translation: zhCN
  },
  "en-US": {
    translation: enUS
  }
};
instance.use(Browser).use(initReactI18next).init({
  resources,
  fallbackLng: "en-US",
  debug: false,
  showSupportNotice: false,
  interpolation: {
    escapeValue: false
  },
  detection: {
    order: ["localStorage", "navigator"],
    caches: ["localStorage"],
    lookupLocalStorage: "i18nextLng",
    convertDetectedLanguage: (lng) => {
      if (lng.includes("zh")) return "zh-CN";
      if (lng.includes("en")) return "en-US";
      return "en-US";
    }
  }
});
const SETTINGS_STORAGE_KEY = "modelport-settings";
const LEGACY_SETTINGS_STORAGE_KEY = "chat2api-settings";
const PERSISTED_PREFERENCE_KEYS = [
  "theme",
  "sidebarCollapsed",
  "proxyEnabled",
  "oauthProxyMode",
  "language",
  "autoStart",
  "autoStartProxy",
  "minimizeToTray",
  "closeBehavior",
  "enableNotifications",
  "logLevel",
  "logRetentionDays",
  "maxLogs"
];
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pickPersistedPreferences(state) {
  if (!isPlainObject(state)) return {};
  const picked = {};
  for (const key of PERSISTED_PREFERENCE_KEYS) {
    const value = state[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      picked[key] = value;
    }
  }
  return picked;
}
function unwrapPersistedBlob(parsed) {
  if (!isPlainObject(parsed)) return null;
  if ("state" in parsed) {
    return { state: parsed.state, version: typeof parsed.version === "number" ? parsed.version : 0 };
  }
  return { state: parsed, version: 0 };
}
function sanitizePersistedSettings(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const unwrapped = unwrapPersistedBlob(parsed);
  if (unwrapped === null) return null;
  return JSON.stringify({ state: pickPersistedPreferences(unwrapped.state), version: unwrapped.version });
}
function containsPersistedSecrets(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const unwrapped = unwrapPersistedBlob(parsed);
  if (unwrapped === null || !isPlainObject(unwrapped.state)) return false;
  const state = unwrapped.state;
  if ("config" in state) return true;
  return Object.keys(state).some((key) => !PERSISTED_PREFERENCE_KEYS.includes(key));
}
function parseExportEnvelope(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (typeof parsed.exportedAt !== "string" || typeof parsed.version !== "string") return null;
  const settings2 = parsed.settings;
  if (typeof settings2 === "string") {
    const cleaned2 = sanitizePersistedSettings(settings2);
    return cleaned2 === null ? null : { version: parsed.version, exportedAt: parsed.exportedAt, settings: cleaned2 };
  }
  const cleaned = sanitizePersistedSettings(JSON.stringify(settings2));
  return cleaned === null ? null : { version: parsed.version, exportedAt: parsed.exportedAt, settings: cleaned };
}
function buildExportEnvelope(version, settings2) {
  return { version, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), settings: settings2 };
}
try {
  const current = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (current === null) {
    const legacy = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (legacy !== null) {
      const cleaned = sanitizePersistedSettings(legacy);
      if (cleaned !== null) localStorage.setItem(SETTINGS_STORAGE_KEY, cleaned);
      localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
    }
  } else if (containsPersistedSecrets(current)) {
    const cleaned = sanitizePersistedSettings(current);
    if (cleaned !== null) localStorage.setItem(SETTINGS_STORAGE_KEY, cleaned);
    console.warn("[Settings] Removed non-preference keys (including credentials) from persisted settings");
  }
} catch (error) {
  console.warn("[Migration] settings localStorage migration failed:", error);
}
const useSettingsStore = create()(
  persist(
    (set, get2) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      proxyEnabled: false,
      setProxyEnabled: (enabled) => set({ proxyEnabled: enabled }),
      oauthProxyMode: "system",
      setOauthProxyMode: async (mode) => {
        set({ oauthProxyMode: mode });
        try {
          await window.electronAPI.config.update({ oauthProxyMode: mode });
        } catch (error) {
          console.error("Failed to update oauthProxyMode:", error);
        }
      },
      language: "en-US",
      setLanguage: async (language) => {
        set({ language });
        await instance.changeLanguage(language);
        try {
          await window.electronAPI.config.update({ language });
        } catch (error) {
          console.error("Failed to update language:", error);
        }
      },
      autoStart: false,
      setAutoStart: async (enabled) => {
        set({ autoStart: enabled });
        try {
          await window.electronAPI.config.update({ autoStart: enabled });
        } catch (error) {
          console.error("Failed to update autoStart:", error);
        }
      },
      autoStartProxy: false,
      setAutoStartProxy: async (enabled) => {
        set({ autoStartProxy: enabled });
        try {
          await window.electronAPI.config.update({ autoStartProxy: enabled });
        } catch (error) {
          console.error("Failed to update autoStartProxy:", error);
        }
      },
      minimizeToTray: true,
      setMinimizeToTray: (enabled) => set({ minimizeToTray: enabled }),
      closeBehavior: "minimize",
      setCloseBehavior: (behavior) => set({ closeBehavior: behavior }),
      enableNotifications: true,
      setEnableNotifications: (enabled) => set({ enableNotifications: enabled }),
      logLevel: "info",
      setLogLevel: (level) => set({ logLevel: level }),
      logRetentionDays: 30,
      setLogRetentionDays: (days) => set({ logRetentionDays: days }),
      maxLogs: 1e4,
      setMaxLogs: (count2) => set({ maxLogs: count2 }),
      config: null,
      setConfig: (config) => set({ config }),
      updateConfig: async (updates) => {
        const currentConfig = get2().config;
        if (!currentConfig) return;
        const newConfig = {
          ...currentConfig,
          ...updates,
          requestLogConfig: updates.requestLogConfig ? {
            ...currentConfig.requestLogConfig,
            ...updates.requestLogConfig
          } : currentConfig.requestLogConfig
        };
        set({ config: newConfig });
        try {
          await window.electronAPI.config.update(updates);
        } catch (error) {
          console.error("Failed to update config:", error);
          set({ config: currentConfig });
        }
      },
      fetchConfig: async () => {
        try {
          const config = await window.electronAPI.config.get();
          set({
            config,
            autoStart: config.autoStart,
            autoStartProxy: config.autoStartProxy,
            oauthProxyMode: config.oauthProxyMode || "system",
            language: config.language || "en-US"
          });
        } catch (error) {
          console.error("Failed to fetch config:", error);
        }
      }
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      // 只持久化界面偏好：`config` 是主进程运行期配置的镜像，`fetchConfig()` 随时能重新
      // 取回。把它写进浏览器存储等于把上游 Key 与管理密钥交给 leveldb、备份盘和「导出配置」，
      // 而主进程那份是整文件加密的，这一份没有任何保护层。白名单见 shared/persistedSettings。
      partialize: (state) => pickPersistedPreferences(state),
      onRehydrateStorage: () => (state) => {
        if (state?.language) {
          instance.changeLanguage(state.language);
        }
      }
    }
  )
);
const useNavigationStore = create((set, get2) => ({
  blockers: [],
  pendingNavigation: null,
  isDialogOpen: false,
  registerBlocker: (id2, message) => {
    set((state) => ({
      blockers: state.blockers.some((b) => b.id === id2) ? state.blockers.map((b) => b.id === id2 ? { ...b, message } : b) : [...state.blockers, { id: id2, message }]
    }));
  },
  unregisterBlocker: (id2) => {
    set((state) => ({
      blockers: state.blockers.filter((b) => b.id !== id2),
      isDialogOpen: state.blockers.length > 1 || state.blockers.length === 1 && state.blockers[0]?.id !== id2 ? state.isDialogOpen : false
    }));
  },
  setPendingNavigation: (navigation) => {
    const { blockers } = get2();
    if (blockers.length > 0 && navigation) {
      set({ pendingNavigation: navigation, isDialogOpen: true });
    } else if (navigation) {
      navigation();
    }
  },
  confirmNavigation: () => {
    const { pendingNavigation } = get2();
    pendingNavigation?.();
    set({ pendingNavigation: null, isDialogOpen: false });
  },
  cancelNavigation: () => {
    set({ pendingNavigation: null, isDialogOpen: false });
  },
  hasBlockers: () => get2().blockers.length > 0
}));
function composeEventHandlers(originalEventHandler, ourEventHandler, { checkForDefaultPrevented = true } = {}) {
  return function handleEvent(event) {
    originalEventHandler?.(event);
    if (checkForDefaultPrevented === false || !event.defaultPrevented) {
      return ourEventHandler?.(event);
    }
  };
}
function setRef(ref, value) {
  if (typeof ref === "function") {
    return ref(value);
  } else if (ref !== null && ref !== void 0) {
    ref.current = value;
  }
}
function composeRefs(...refs) {
  return (node) => {
    let hasCleanup = false;
    const cleanups = refs.map((ref) => {
      const cleanup = setRef(ref, node);
      if (!hasCleanup && typeof cleanup == "function") {
        hasCleanup = true;
      }
      return cleanup;
    });
    if (hasCleanup) {
      return () => {
        for (let i = 0; i < cleanups.length; i++) {
          const cleanup = cleanups[i];
          if (typeof cleanup == "function") {
            cleanup();
          } else {
            setRef(refs[i], null);
          }
        }
      };
    }
  };
}
function useComposedRefs(...refs) {
  return reactExports.useCallback(composeRefs(...refs), refs);
}
function createContext2(rootComponentName, defaultContext) {
  const Context = reactExports.createContext(defaultContext);
  const Provider2 = (props) => {
    const { children, ...context } = props;
    const value = reactExports.useMemo(() => context, Object.values(context));
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Context.Provider, { value, children });
  };
  Provider2.displayName = rootComponentName + "Provider";
  function useContext2(consumerName) {
    const context = reactExports.useContext(Context);
    if (context) return context;
    if (defaultContext !== void 0) return defaultContext;
    throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
  }
  return [Provider2, useContext2];
}
function createContextScope(scopeName, createContextScopeDeps = []) {
  let defaultContexts = [];
  function createContext3(rootComponentName, defaultContext) {
    const BaseContext = reactExports.createContext(defaultContext);
    const index = defaultContexts.length;
    defaultContexts = [...defaultContexts, defaultContext];
    const Provider2 = (props) => {
      const { scope, children, ...context } = props;
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const value = reactExports.useMemo(() => context, Object.values(context));
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Context.Provider, { value, children });
    };
    Provider2.displayName = rootComponentName + "Provider";
    function useContext2(consumerName, scope) {
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const context = reactExports.useContext(Context);
      if (context) return context;
      if (defaultContext !== void 0) return defaultContext;
      throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
    }
    return [Provider2, useContext2];
  }
  const createScope = () => {
    const scopeContexts = defaultContexts.map((defaultContext) => {
      return reactExports.createContext(defaultContext);
    });
    return function useScope(scope) {
      const contexts = scope?.[scopeName] || scopeContexts;
      return reactExports.useMemo(
        () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
        [scope, contexts]
      );
    };
  };
  createScope.scopeName = scopeName;
  return [createContext3, composeContextScopes(createScope, ...createContextScopeDeps)];
}
function composeContextScopes(...scopes) {
  const baseScope = scopes[0];
  if (scopes.length === 1) return baseScope;
  const createScope = () => {
    const scopeHooks = scopes.map((createScope2) => ({
      useScope: createScope2(),
      scopeName: createScope2.scopeName
    }));
    return function useComposedScopes(overrideScopes) {
      const nextScopes = scopeHooks.reduce((nextScopes2, { useScope, scopeName }) => {
        const scopeProps = useScope(overrideScopes);
        const currentScope = scopeProps[`__scope${scopeName}`];
        return { ...nextScopes2, ...currentScope };
      }, {});
      return reactExports.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
    };
  };
  createScope.scopeName = baseScope.scopeName;
  return createScope;
}
var useLayoutEffect2 = globalThis?.document ? reactExports.useLayoutEffect : () => {
};
var useReactId = React$2[" useId ".trim().toString()] || (() => void 0);
var count$2 = 0;
function useId(deterministicId) {
  const [id2, setId] = reactExports.useState(useReactId());
  useLayoutEffect2(() => {
    setId((reactId) => reactId ?? String(count$2++));
  }, [deterministicId]);
  return deterministicId || (id2 ? `radix-${id2}` : "");
}
var useInsertionEffect = React$2[" useInsertionEffect ".trim().toString()] || useLayoutEffect2;
function useControllableState({
  prop,
  defaultProp,
  onChange = () => {
  },
  caller
}) {
  const [uncontrolledProp, setUncontrolledProp, onChangeRef] = useUncontrolledState({
    defaultProp,
    onChange
  });
  const isControlled = prop !== void 0;
  const value = isControlled ? prop : uncontrolledProp;
  {
    const isControlledRef = reactExports.useRef(prop !== void 0);
    reactExports.useEffect(() => {
      const wasControlled = isControlledRef.current;
      if (wasControlled !== isControlled) {
        const from = wasControlled ? "controlled" : "uncontrolled";
        const to = isControlled ? "controlled" : "uncontrolled";
        console.warn(
          `${caller} is changing from ${from} to ${to}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`
        );
      }
      isControlledRef.current = isControlled;
    }, [isControlled, caller]);
  }
  const setValue = reactExports.useCallback(
    (nextValue) => {
      if (isControlled) {
        const value2 = isFunction(nextValue) ? nextValue(prop) : nextValue;
        if (value2 !== prop) {
          onChangeRef.current?.(value2);
        }
      } else {
        setUncontrolledProp(nextValue);
      }
    },
    [isControlled, prop, setUncontrolledProp, onChangeRef]
  );
  return [value, setValue];
}
function useUncontrolledState({
  defaultProp,
  onChange
}) {
  const [value, setValue] = reactExports.useState(defaultProp);
  const prevValueRef = reactExports.useRef(value);
  const onChangeRef = reactExports.useRef(onChange);
  useInsertionEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  reactExports.useEffect(() => {
    if (prevValueRef.current !== value) {
      onChangeRef.current?.(value);
      prevValueRef.current = value;
    }
  }, [value, prevValueRef]);
  return [value, setValue, onChangeRef];
}
function isFunction(value) {
  return typeof value === "function";
}
// @__NO_SIDE_EFFECTS__
function createSlot$3(ownerName) {
  const SlotClone = /* @__PURE__ */ createSlotClone$3(ownerName);
  const Slot2 = reactExports.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    const childrenArray = reactExports.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable$3);
    if (slottable) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) => {
        if (child === slottable) {
          if (reactExports.Children.count(newElement) > 1) return reactExports.Children.only(null);
          return reactExports.isValidElement(newElement) ? newElement.props.children : null;
        } else {
          return child;
        }
      });
      return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children: reactExports.isValidElement(newElement) ? reactExports.cloneElement(newElement, void 0, newChildren) : null });
    }
    return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children });
  });
  Slot2.displayName = `${ownerName}.Slot`;
  return Slot2;
}
// @__NO_SIDE_EFFECTS__
function createSlotClone$3(ownerName) {
  const SlotClone = reactExports.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    if (reactExports.isValidElement(children)) {
      const childrenRef = getElementRef$4(children);
      const props2 = mergeProps$3(slotProps, children.props);
      if (children.type !== reactExports.Fragment) {
        props2.ref = forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef;
      }
      return reactExports.cloneElement(children, props2);
    }
    return reactExports.Children.count(children) > 1 ? reactExports.Children.only(null) : null;
  });
  SlotClone.displayName = `${ownerName}.SlotClone`;
  return SlotClone;
}
var SLOTTABLE_IDENTIFIER$3 = Symbol("radix.slottable");
function isSlottable$3(child) {
  return reactExports.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER$3;
}
function mergeProps$3(slotProps, childProps) {
  const overrideProps = { ...childProps };
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];
    const isHandler = /^on[A-Z]/.test(propName);
    if (isHandler) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args) => {
          const result = childPropValue(...args);
          slotPropValue(...args);
          return result;
        };
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    } else if (propName === "style") {
      overrideProps[propName] = { ...slotPropValue, ...childPropValue };
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
    }
  }
  return { ...slotProps, ...overrideProps };
}
function getElementRef$4(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.ref;
  }
  getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
  mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.props.ref;
  }
  return element.props.ref || element.ref;
}
var NODES = [
  "a",
  "button",
  "div",
  "form",
  "h2",
  "h3",
  "img",
  "input",
  "label",
  "li",
  "nav",
  "ol",
  "p",
  "select",
  "span",
  "svg",
  "ul"
];
var Primitive = NODES.reduce((primitive, node) => {
  const Slot2 = /* @__PURE__ */ createSlot$3(`Primitive.${node}`);
  const Node2 = reactExports.forwardRef((props, forwardedRef) => {
    const { asChild, ...primitiveProps } = props;
    const Comp = asChild ? Slot2 : node;
    if (typeof window !== "undefined") {
      window[Symbol.for("radix-ui")] = true;
    }
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Comp, { ...primitiveProps, ref: forwardedRef });
  });
  Node2.displayName = `Primitive.${node}`;
  return { ...primitive, [node]: Node2 };
}, {});
function dispatchDiscreteCustomEvent(target, event) {
  if (target) reactDomExports.flushSync(() => target.dispatchEvent(event));
}
function useCallbackRef$1(callback) {
  const callbackRef = reactExports.useRef(callback);
  reactExports.useEffect(() => {
    callbackRef.current = callback;
  });
  return reactExports.useMemo(() => (...args) => callbackRef.current?.(...args), []);
}
function useEscapeKeydown(onEscapeKeyDownProp, ownerDocument = globalThis?.document) {
  const onEscapeKeyDown = useCallbackRef$1(onEscapeKeyDownProp);
  reactExports.useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onEscapeKeyDown(event);
      }
    };
    ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => ownerDocument.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onEscapeKeyDown, ownerDocument]);
}
var DISMISSABLE_LAYER_NAME = "DismissableLayer";
var CONTEXT_UPDATE = "dismissableLayer.update";
var POINTER_DOWN_OUTSIDE = "dismissableLayer.pointerDownOutside";
var FOCUS_OUTSIDE = "dismissableLayer.focusOutside";
var originalBodyPointerEvents;
var DismissableLayerContext = reactExports.createContext({
  layers: /* @__PURE__ */ new Set(),
  layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
  branches: /* @__PURE__ */ new Set()
});
var DismissableLayer = reactExports.forwardRef(
  (props, forwardedRef) => {
    const {
      disableOutsidePointerEvents = false,
      onEscapeKeyDown,
      onPointerDownOutside,
      onFocusOutside,
      onInteractOutside,
      onDismiss,
      ...layerProps
    } = props;
    const context = reactExports.useContext(DismissableLayerContext);
    const [node, setNode] = reactExports.useState(null);
    const ownerDocument = node?.ownerDocument ?? globalThis?.document;
    const [, force] = reactExports.useState({});
    const composedRefs = useComposedRefs(forwardedRef, (node2) => setNode(node2));
    const layers = Array.from(context.layers);
    const [highestLayerWithOutsidePointerEventsDisabled] = [...context.layersWithOutsidePointerEventsDisabled].slice(-1);
    const highestLayerWithOutsidePointerEventsDisabledIndex = layers.indexOf(highestLayerWithOutsidePointerEventsDisabled);
    const index = node ? layers.indexOf(node) : -1;
    const isBodyPointerEventsDisabled = context.layersWithOutsidePointerEventsDisabled.size > 0;
    const isPointerEventsEnabled = index >= highestLayerWithOutsidePointerEventsDisabledIndex;
    const pointerDownOutside = usePointerDownOutside((event) => {
      const target = event.target;
      const isPointerDownOnBranch = [...context.branches].some((branch) => branch.contains(target));
      if (!isPointerEventsEnabled || isPointerDownOnBranch) return;
      onPointerDownOutside?.(event);
      onInteractOutside?.(event);
      if (!event.defaultPrevented) onDismiss?.();
    }, ownerDocument);
    const focusOutside = useFocusOutside((event) => {
      const target = event.target;
      const isFocusInBranch = [...context.branches].some((branch) => branch.contains(target));
      if (isFocusInBranch) return;
      onFocusOutside?.(event);
      onInteractOutside?.(event);
      if (!event.defaultPrevented) onDismiss?.();
    }, ownerDocument);
    useEscapeKeydown((event) => {
      const isHighestLayer = index === context.layers.size - 1;
      if (!isHighestLayer) return;
      onEscapeKeyDown?.(event);
      if (!event.defaultPrevented && onDismiss) {
        event.preventDefault();
        onDismiss();
      }
    }, ownerDocument);
    reactExports.useEffect(() => {
      if (!node) return;
      if (disableOutsidePointerEvents) {
        if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
          originalBodyPointerEvents = ownerDocument.body.style.pointerEvents;
          ownerDocument.body.style.pointerEvents = "none";
        }
        context.layersWithOutsidePointerEventsDisabled.add(node);
      }
      context.layers.add(node);
      dispatchUpdate();
      return () => {
        if (disableOutsidePointerEvents && context.layersWithOutsidePointerEventsDisabled.size === 1) {
          ownerDocument.body.style.pointerEvents = originalBodyPointerEvents;
        }
      };
    }, [node, ownerDocument, disableOutsidePointerEvents, context]);
    reactExports.useEffect(() => {
      return () => {
        if (!node) return;
        context.layers.delete(node);
        context.layersWithOutsidePointerEventsDisabled.delete(node);
        dispatchUpdate();
      };
    }, [node, context]);
    reactExports.useEffect(() => {
      const handleUpdate = () => force({});
      document.addEventListener(CONTEXT_UPDATE, handleUpdate);
      return () => document.removeEventListener(CONTEXT_UPDATE, handleUpdate);
    }, []);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Primitive.div,
      {
        ...layerProps,
        ref: composedRefs,
        style: {
          pointerEvents: isBodyPointerEventsDisabled ? isPointerEventsEnabled ? "auto" : "none" : void 0,
          ...props.style
        },
        onFocusCapture: composeEventHandlers(props.onFocusCapture, focusOutside.onFocusCapture),
        onBlurCapture: composeEventHandlers(props.onBlurCapture, focusOutside.onBlurCapture),
        onPointerDownCapture: composeEventHandlers(
          props.onPointerDownCapture,
          pointerDownOutside.onPointerDownCapture
        )
      }
    );
  }
);
DismissableLayer.displayName = DISMISSABLE_LAYER_NAME;
var BRANCH_NAME = "DismissableLayerBranch";
var DismissableLayerBranch = reactExports.forwardRef((props, forwardedRef) => {
  const context = reactExports.useContext(DismissableLayerContext);
  const ref = reactExports.useRef(null);
  const composedRefs = useComposedRefs(forwardedRef, ref);
  reactExports.useEffect(() => {
    const node = ref.current;
    if (node) {
      context.branches.add(node);
      return () => {
        context.branches.delete(node);
      };
    }
  }, [context.branches]);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.div, { ...props, ref: composedRefs });
});
DismissableLayerBranch.displayName = BRANCH_NAME;
function usePointerDownOutside(onPointerDownOutside, ownerDocument = globalThis?.document) {
  const handlePointerDownOutside = useCallbackRef$1(onPointerDownOutside);
  const isPointerInsideReactTreeRef = reactExports.useRef(false);
  const handleClickRef = reactExports.useRef(() => {
  });
  reactExports.useEffect(() => {
    const handlePointerDown = (event) => {
      if (event.target && !isPointerInsideReactTreeRef.current) {
        let handleAndDispatchPointerDownOutsideEvent2 = function() {
          handleAndDispatchCustomEvent$1(
            POINTER_DOWN_OUTSIDE,
            handlePointerDownOutside,
            eventDetail,
            { discrete: true }
          );
        };
        const eventDetail = { originalEvent: event };
        if (event.pointerType === "touch") {
          ownerDocument.removeEventListener("click", handleClickRef.current);
          handleClickRef.current = handleAndDispatchPointerDownOutsideEvent2;
          ownerDocument.addEventListener("click", handleClickRef.current, { once: true });
        } else {
          handleAndDispatchPointerDownOutsideEvent2();
        }
      } else {
        ownerDocument.removeEventListener("click", handleClickRef.current);
      }
      isPointerInsideReactTreeRef.current = false;
    };
    const timerId = window.setTimeout(() => {
      ownerDocument.addEventListener("pointerdown", handlePointerDown);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("click", handleClickRef.current);
    };
  }, [ownerDocument, handlePointerDownOutside]);
  return {
    // ensures we check React component tree (not just DOM tree)
    onPointerDownCapture: () => isPointerInsideReactTreeRef.current = true
  };
}
function useFocusOutside(onFocusOutside, ownerDocument = globalThis?.document) {
  const handleFocusOutside = useCallbackRef$1(onFocusOutside);
  const isFocusInsideReactTreeRef = reactExports.useRef(false);
  reactExports.useEffect(() => {
    const handleFocus = (event) => {
      if (event.target && !isFocusInsideReactTreeRef.current) {
        const eventDetail = { originalEvent: event };
        handleAndDispatchCustomEvent$1(FOCUS_OUTSIDE, handleFocusOutside, eventDetail, {
          discrete: false
        });
      }
    };
    ownerDocument.addEventListener("focusin", handleFocus);
    return () => ownerDocument.removeEventListener("focusin", handleFocus);
  }, [ownerDocument, handleFocusOutside]);
  return {
    onFocusCapture: () => isFocusInsideReactTreeRef.current = true,
    onBlurCapture: () => isFocusInsideReactTreeRef.current = false
  };
}
function dispatchUpdate() {
  const event = new CustomEvent(CONTEXT_UPDATE);
  document.dispatchEvent(event);
}
function handleAndDispatchCustomEvent$1(name, handler, detail, { discrete }) {
  const target = detail.originalEvent.target;
  const event = new CustomEvent(name, { bubbles: false, cancelable: true, detail });
  if (handler) target.addEventListener(name, handler, { once: true });
  if (discrete) {
    dispatchDiscreteCustomEvent(target, event);
  } else {
    target.dispatchEvent(event);
  }
}
var Root$2 = DismissableLayer;
var Branch = DismissableLayerBranch;
var AUTOFOCUS_ON_MOUNT = "focusScope.autoFocusOnMount";
var AUTOFOCUS_ON_UNMOUNT = "focusScope.autoFocusOnUnmount";
var EVENT_OPTIONS = { bubbles: false, cancelable: true };
var FOCUS_SCOPE_NAME = "FocusScope";
var FocusScope = reactExports.forwardRef((props, forwardedRef) => {
  const {
    loop = false,
    trapped = false,
    onMountAutoFocus: onMountAutoFocusProp,
    onUnmountAutoFocus: onUnmountAutoFocusProp,
    ...scopeProps
  } = props;
  const [container, setContainer] = reactExports.useState(null);
  const onMountAutoFocus = useCallbackRef$1(onMountAutoFocusProp);
  const onUnmountAutoFocus = useCallbackRef$1(onUnmountAutoFocusProp);
  const lastFocusedElementRef = reactExports.useRef(null);
  const composedRefs = useComposedRefs(forwardedRef, (node) => setContainer(node));
  const focusScope = reactExports.useRef({
    paused: false,
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    }
  }).current;
  reactExports.useEffect(() => {
    if (trapped) {
      let handleFocusIn2 = function(event) {
        if (focusScope.paused || !container) return;
        const target = event.target;
        if (container.contains(target)) {
          lastFocusedElementRef.current = target;
        } else {
          focus(lastFocusedElementRef.current, { select: true });
        }
      }, handleFocusOut2 = function(event) {
        if (focusScope.paused || !container) return;
        const relatedTarget = event.relatedTarget;
        if (relatedTarget === null) return;
        if (!container.contains(relatedTarget)) {
          focus(lastFocusedElementRef.current, { select: true });
        }
      }, handleMutations2 = function(mutations) {
        const focusedElement = document.activeElement;
        if (focusedElement !== document.body) return;
        for (const mutation of mutations) {
          if (mutation.removedNodes.length > 0) focus(container);
        }
      };
      document.addEventListener("focusin", handleFocusIn2);
      document.addEventListener("focusout", handleFocusOut2);
      const mutationObserver = new MutationObserver(handleMutations2);
      if (container) mutationObserver.observe(container, { childList: true, subtree: true });
      return () => {
        document.removeEventListener("focusin", handleFocusIn2);
        document.removeEventListener("focusout", handleFocusOut2);
        mutationObserver.disconnect();
      };
    }
  }, [trapped, container, focusScope.paused]);
  reactExports.useEffect(() => {
    if (container) {
      focusScopesStack.add(focusScope);
      const previouslyFocusedElement = document.activeElement;
      const hasFocusedCandidate = container.contains(previouslyFocusedElement);
      if (!hasFocusedCandidate) {
        const mountEvent = new CustomEvent(AUTOFOCUS_ON_MOUNT, EVENT_OPTIONS);
        container.addEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus);
        container.dispatchEvent(mountEvent);
        if (!mountEvent.defaultPrevented) {
          focusFirst$1(removeLinks(getTabbableCandidates$1(container)), { select: true });
          if (document.activeElement === previouslyFocusedElement) {
            focus(container);
          }
        }
      }
      return () => {
        container.removeEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus);
        setTimeout(() => {
          const unmountEvent = new CustomEvent(AUTOFOCUS_ON_UNMOUNT, EVENT_OPTIONS);
          container.addEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus);
          container.dispatchEvent(unmountEvent);
          if (!unmountEvent.defaultPrevented) {
            focus(previouslyFocusedElement ?? document.body, { select: true });
          }
          container.removeEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus);
          focusScopesStack.remove(focusScope);
        }, 0);
      };
    }
  }, [container, onMountAutoFocus, onUnmountAutoFocus, focusScope]);
  const handleKeyDown = reactExports.useCallback(
    (event) => {
      if (!loop && !trapped) return;
      if (focusScope.paused) return;
      const isTabKey = event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
      const focusedElement = document.activeElement;
      if (isTabKey && focusedElement) {
        const container2 = event.currentTarget;
        const [first, last] = getTabbableEdges(container2);
        const hasTabbableElementsInside = first && last;
        if (!hasTabbableElementsInside) {
          if (focusedElement === container2) event.preventDefault();
        } else {
          if (!event.shiftKey && focusedElement === last) {
            event.preventDefault();
            if (loop) focus(first, { select: true });
          } else if (event.shiftKey && focusedElement === first) {
            event.preventDefault();
            if (loop) focus(last, { select: true });
          }
        }
      }
    },
    [loop, trapped, focusScope.paused]
  );
  return /* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.div, { tabIndex: -1, ...scopeProps, ref: composedRefs, onKeyDown: handleKeyDown });
});
FocusScope.displayName = FOCUS_SCOPE_NAME;
function focusFirst$1(candidates, { select = false } = {}) {
  const previouslyFocusedElement = document.activeElement;
  for (const candidate of candidates) {
    focus(candidate, { select });
    if (document.activeElement !== previouslyFocusedElement) return;
  }
}
function getTabbableEdges(container) {
  const candidates = getTabbableCandidates$1(container);
  const first = findVisible(candidates, container);
  const last = findVisible(candidates.reverse(), container);
  return [first, last];
}
function getTabbableCandidates$1(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const isHiddenInput = node.tagName === "INPUT" && node.type === "hidden";
      if (node.disabled || node.hidden || isHiddenInput) return NodeFilter.FILTER_SKIP;
      return node.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}
function findVisible(elements, container) {
  for (const element of elements) {
    if (!isHidden(element, { upTo: container })) return element;
  }
}
function isHidden(node, { upTo }) {
  if (getComputedStyle(node).visibility === "hidden") return true;
  while (node) {
    if (upTo !== void 0 && node === upTo) return false;
    if (getComputedStyle(node).display === "none") return true;
    node = node.parentElement;
  }
  return false;
}
function isSelectableInput(element) {
  return element instanceof HTMLInputElement && "select" in element;
}
function focus(element, { select = false } = {}) {
  if (element && element.focus) {
    const previouslyFocusedElement = document.activeElement;
    element.focus({ preventScroll: true });
    if (element !== previouslyFocusedElement && isSelectableInput(element) && select)
      element.select();
  }
}
var focusScopesStack = createFocusScopesStack();
function createFocusScopesStack() {
  let stack = [];
  return {
    add(focusScope) {
      const activeFocusScope = stack[0];
      if (focusScope !== activeFocusScope) {
        activeFocusScope?.pause();
      }
      stack = arrayRemove(stack, focusScope);
      stack.unshift(focusScope);
    },
    remove(focusScope) {
      stack = arrayRemove(stack, focusScope);
      stack[0]?.resume();
    }
  };
}
function arrayRemove(array, item) {
  const updatedArray = [...array];
  const index = updatedArray.indexOf(item);
  if (index !== -1) {
    updatedArray.splice(index, 1);
  }
  return updatedArray;
}
function removeLinks(items) {
  return items.filter((item) => item.tagName !== "A");
}
var PORTAL_NAME$1 = "Portal";
var Portal$1 = reactExports.forwardRef((props, forwardedRef) => {
  const { container: containerProp, ...portalProps } = props;
  const [mounted, setMounted] = reactExports.useState(false);
  useLayoutEffect2(() => setMounted(true), []);
  const container = containerProp || mounted && globalThis?.document?.body;
  return container ? ReactDOM.createPortal(/* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.div, { ...portalProps, ref: forwardedRef }), container) : null;
});
Portal$1.displayName = PORTAL_NAME$1;
function useStateMachine(initialState, machine) {
  return reactExports.useReducer((state, event) => {
    const nextState = machine[state][event];
    return nextState ?? state;
  }, initialState);
}
var Presence = (props) => {
  const { present, children } = props;
  const presence = usePresence(present);
  const child = typeof children === "function" ? children({ present: presence.isPresent }) : reactExports.Children.only(children);
  const ref = useComposedRefs(presence.ref, getElementRef$3(child));
  const forceMount = typeof children === "function";
  return forceMount || presence.isPresent ? reactExports.cloneElement(child, { ref }) : null;
};
Presence.displayName = "Presence";
function usePresence(present) {
  const [node, setNode] = reactExports.useState();
  const stylesRef = reactExports.useRef(null);
  const prevPresentRef = reactExports.useRef(present);
  const prevAnimationNameRef = reactExports.useRef("none");
  const initialState = present ? "mounted" : "unmounted";
  const [state, send] = useStateMachine(initialState, {
    mounted: {
      UNMOUNT: "unmounted",
      ANIMATION_OUT: "unmountSuspended"
    },
    unmountSuspended: {
      MOUNT: "mounted",
      ANIMATION_END: "unmounted"
    },
    unmounted: {
      MOUNT: "mounted"
    }
  });
  reactExports.useEffect(() => {
    const currentAnimationName = getAnimationName(stylesRef.current);
    prevAnimationNameRef.current = state === "mounted" ? currentAnimationName : "none";
  }, [state]);
  useLayoutEffect2(() => {
    const styles = stylesRef.current;
    const wasPresent = prevPresentRef.current;
    const hasPresentChanged = wasPresent !== present;
    if (hasPresentChanged) {
      const prevAnimationName = prevAnimationNameRef.current;
      const currentAnimationName = getAnimationName(styles);
      if (present) {
        send("MOUNT");
      } else if (currentAnimationName === "none" || styles?.display === "none") {
        send("UNMOUNT");
      } else {
        const isAnimating = prevAnimationName !== currentAnimationName;
        if (wasPresent && isAnimating) {
          send("ANIMATION_OUT");
        } else {
          send("UNMOUNT");
        }
      }
      prevPresentRef.current = present;
    }
  }, [present, send]);
  useLayoutEffect2(() => {
    if (node) {
      let timeoutId;
      const ownerWindow = node.ownerDocument.defaultView ?? window;
      const handleAnimationEnd = (event) => {
        const currentAnimationName = getAnimationName(stylesRef.current);
        const isCurrentAnimation = currentAnimationName.includes(CSS.escape(event.animationName));
        if (event.target === node && isCurrentAnimation) {
          send("ANIMATION_END");
          if (!prevPresentRef.current) {
            const currentFillMode = node.style.animationFillMode;
            node.style.animationFillMode = "forwards";
            timeoutId = ownerWindow.setTimeout(() => {
              if (node.style.animationFillMode === "forwards") {
                node.style.animationFillMode = currentFillMode;
              }
            });
          }
        }
      };
      const handleAnimationStart = (event) => {
        if (event.target === node) {
          prevAnimationNameRef.current = getAnimationName(stylesRef.current);
        }
      };
      node.addEventListener("animationstart", handleAnimationStart);
      node.addEventListener("animationcancel", handleAnimationEnd);
      node.addEventListener("animationend", handleAnimationEnd);
      return () => {
        ownerWindow.clearTimeout(timeoutId);
        node.removeEventListener("animationstart", handleAnimationStart);
        node.removeEventListener("animationcancel", handleAnimationEnd);
        node.removeEventListener("animationend", handleAnimationEnd);
      };
    } else {
      send("ANIMATION_END");
    }
  }, [node, send]);
  return {
    isPresent: ["mounted", "unmountSuspended"].includes(state),
    ref: reactExports.useCallback((node2) => {
      stylesRef.current = node2 ? getComputedStyle(node2) : null;
      setNode(node2);
    }, [])
  };
}
function getAnimationName(styles) {
  return styles?.animationName || "none";
}
function getElementRef$3(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.ref;
  }
  getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
  mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.props.ref;
  }
  return element.props.ref || element.ref;
}
var count$1 = 0;
function useFocusGuards() {
  reactExports.useEffect(() => {
    const edgeGuards = document.querySelectorAll("[data-radix-focus-guard]");
    document.body.insertAdjacentElement("afterbegin", edgeGuards[0] ?? createFocusGuard());
    document.body.insertAdjacentElement("beforeend", edgeGuards[1] ?? createFocusGuard());
    count$1++;
    return () => {
      if (count$1 === 1) {
        document.querySelectorAll("[data-radix-focus-guard]").forEach((node) => node.remove());
      }
      count$1--;
    };
  }, []);
}
function createFocusGuard() {
  const element = document.createElement("span");
  element.setAttribute("data-radix-focus-guard", "");
  element.tabIndex = 0;
  element.style.outline = "none";
  element.style.opacity = "0";
  element.style.position = "fixed";
  element.style.pointerEvents = "none";
  return element;
}
var __assign = function() {
  __assign = Object.assign || function __assign2(t2) {
    for (var s, i = 1, n2 = arguments.length; i < n2; i++) {
      s = arguments[i];
      for (var p2 in s) if (Object.prototype.hasOwnProperty.call(s, p2)) t2[p2] = s[p2];
    }
    return t2;
  };
  return __assign.apply(this, arguments);
};
function __rest(s, e) {
  var t2 = {};
  for (var p2 in s) if (Object.prototype.hasOwnProperty.call(s, p2) && e.indexOf(p2) < 0)
    t2[p2] = s[p2];
  if (s != null && typeof Object.getOwnPropertySymbols === "function")
    for (var i = 0, p2 = Object.getOwnPropertySymbols(s); i < p2.length; i++) {
      if (e.indexOf(p2[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p2[i]))
        t2[p2[i]] = s[p2[i]];
    }
  return t2;
}
function __spreadArray(to, from, pack) {
  if (pack || arguments.length === 2) for (var i = 0, l2 = from.length, ar; i < l2; i++) {
    if (ar || !(i in from)) {
      if (!ar) ar = Array.prototype.slice.call(from, 0, i);
      ar[i] = from[i];
    }
  }
  return to.concat(ar || Array.prototype.slice.call(from));
}
typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
  var e = new Error(message);
  return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};
var zeroRightClassName = "right-scroll-bar-position";
var fullWidthClassName = "width-before-scroll-bar";
var noScrollbarsClassName = "with-scroll-bars-hidden";
var removedBarSizeVariable = "--removed-body-scroll-bar-size";
function assignRef(ref, value) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
  return ref;
}
function useCallbackRef(initialValue, callback) {
  var ref = reactExports.useState(function() {
    return {
      // value
      value: initialValue,
      // last callback
      callback,
      // "memoized" public interface
      facade: {
        get current() {
          return ref.value;
        },
        set current(value) {
          var last = ref.value;
          if (last !== value) {
            ref.value = value;
            ref.callback(value, last);
          }
        }
      }
    };
  })[0];
  ref.callback = callback;
  return ref.facade;
}
var useIsomorphicLayoutEffect = typeof window !== "undefined" ? reactExports.useLayoutEffect : reactExports.useEffect;
var currentValues = /* @__PURE__ */ new WeakMap();
function useMergeRefs(refs, defaultValue) {
  var callbackRef = useCallbackRef(null, function(newValue) {
    return refs.forEach(function(ref) {
      return assignRef(ref, newValue);
    });
  });
  useIsomorphicLayoutEffect(function() {
    var oldValue = currentValues.get(callbackRef);
    if (oldValue) {
      var prevRefs_1 = new Set(oldValue);
      var nextRefs_1 = new Set(refs);
      var current_1 = callbackRef.current;
      prevRefs_1.forEach(function(ref) {
        if (!nextRefs_1.has(ref)) {
          assignRef(ref, null);
        }
      });
      nextRefs_1.forEach(function(ref) {
        if (!prevRefs_1.has(ref)) {
          assignRef(ref, current_1);
        }
      });
    }
    currentValues.set(callbackRef, refs);
  }, [refs]);
  return callbackRef;
}
function ItoI(a) {
  return a;
}
function innerCreateMedium(defaults2, middleware) {
  if (middleware === void 0) {
    middleware = ItoI;
  }
  var buffer = [];
  var assigned = false;
  var medium = {
    read: function() {
      if (assigned) {
        throw new Error("Sidecar: could not `read` from an `assigned` medium. `read` could be used only with `useMedium`.");
      }
      if (buffer.length) {
        return buffer[buffer.length - 1];
      }
      return defaults2;
    },
    useMedium: function(data) {
      var item = middleware(data, assigned);
      buffer.push(item);
      return function() {
        buffer = buffer.filter(function(x2) {
          return x2 !== item;
        });
      };
    },
    assignSyncMedium: function(cb2) {
      assigned = true;
      while (buffer.length) {
        var cbs = buffer;
        buffer = [];
        cbs.forEach(cb2);
      }
      buffer = {
        push: function(x2) {
          return cb2(x2);
        },
        filter: function() {
          return buffer;
        }
      };
    },
    assignMedium: function(cb2) {
      assigned = true;
      var pendingQueue = [];
      if (buffer.length) {
        var cbs = buffer;
        buffer = [];
        cbs.forEach(cb2);
        pendingQueue = buffer;
      }
      var executeQueue = function() {
        var cbs2 = pendingQueue;
        pendingQueue = [];
        cbs2.forEach(cb2);
      };
      var cycle = function() {
        return Promise.resolve().then(executeQueue);
      };
      cycle();
      buffer = {
        push: function(x2) {
          pendingQueue.push(x2);
          cycle();
        },
        filter: function(filter) {
          pendingQueue = pendingQueue.filter(filter);
          return buffer;
        }
      };
    }
  };
  return medium;
}
function createSidecarMedium(options) {
  if (options === void 0) {
    options = {};
  }
  var medium = innerCreateMedium(null);
  medium.options = __assign({ async: true, ssr: false }, options);
  return medium;
}
var SideCar$1 = function(_a) {
  var sideCar = _a.sideCar, rest = __rest(_a, ["sideCar"]);
  if (!sideCar) {
    throw new Error("Sidecar: please provide `sideCar` property to import the right car");
  }
  var Target = sideCar.read();
  if (!Target) {
    throw new Error("Sidecar medium not found");
  }
  return reactExports.createElement(Target, __assign({}, rest));
};
SideCar$1.isSideCarExport = true;
function exportSidecar(medium, exported) {
  medium.useMedium(exported);
  return SideCar$1;
}
var effectCar = createSidecarMedium();
var nothing = function() {
  return;
};
var RemoveScroll = reactExports.forwardRef(function(props, parentRef) {
  var ref = reactExports.useRef(null);
  var _a = reactExports.useState({
    onScrollCapture: nothing,
    onWheelCapture: nothing,
    onTouchMoveCapture: nothing
  }), callbacks = _a[0], setCallbacks = _a[1];
  var forwardProps = props.forwardProps, children = props.children, className = props.className, removeScrollBar = props.removeScrollBar, enabled = props.enabled, shards = props.shards, sideCar = props.sideCar, noRelative = props.noRelative, noIsolation = props.noIsolation, inert = props.inert, allowPinchZoom = props.allowPinchZoom, _b = props.as, Container = _b === void 0 ? "div" : _b, gapMode = props.gapMode, rest = __rest(props, ["forwardProps", "children", "className", "removeScrollBar", "enabled", "shards", "sideCar", "noRelative", "noIsolation", "inert", "allowPinchZoom", "as", "gapMode"]);
  var SideCar2 = sideCar;
  var containerRef = useMergeRefs([ref, parentRef]);
  var containerProps = __assign(__assign({}, rest), callbacks);
  return reactExports.createElement(
    reactExports.Fragment,
    null,
    enabled && reactExports.createElement(SideCar2, { sideCar: effectCar, removeScrollBar, shards, noRelative, noIsolation, inert, setCallbacks, allowPinchZoom: !!allowPinchZoom, lockRef: ref, gapMode }),
    forwardProps ? reactExports.cloneElement(reactExports.Children.only(children), __assign(__assign({}, containerProps), { ref: containerRef })) : reactExports.createElement(Container, __assign({}, containerProps, { className, ref: containerRef }), children)
  );
});
RemoveScroll.defaultProps = {
  enabled: true,
  removeScrollBar: true,
  inert: false
};
RemoveScroll.classNames = {
  fullWidth: fullWidthClassName,
  zeroRight: zeroRightClassName
};
var getNonce = function() {
  if (typeof __webpack_nonce__ !== "undefined") {
    return __webpack_nonce__;
  }
  return void 0;
};
function makeStyleTag() {
  if (!document)
    return null;
  var tag = document.createElement("style");
  tag.type = "text/css";
  var nonce = getNonce();
  if (nonce) {
    tag.setAttribute("nonce", nonce);
  }
  return tag;
}
function injectStyles(tag, css) {
  if (tag.styleSheet) {
    tag.styleSheet.cssText = css;
  } else {
    tag.appendChild(document.createTextNode(css));
  }
}
function insertStyleTag(tag) {
  var head = document.head || document.getElementsByTagName("head")[0];
  head.appendChild(tag);
}
var stylesheetSingleton = function() {
  var counter = 0;
  var stylesheet = null;
  return {
    add: function(style) {
      if (counter == 0) {
        if (stylesheet = makeStyleTag()) {
          injectStyles(stylesheet, style);
          insertStyleTag(stylesheet);
        }
      }
      counter++;
    },
    remove: function() {
      counter--;
      if (!counter && stylesheet) {
        stylesheet.parentNode && stylesheet.parentNode.removeChild(stylesheet);
        stylesheet = null;
      }
    }
  };
};
var styleHookSingleton = function() {
  var sheet = stylesheetSingleton();
  return function(styles, isDynamic) {
    reactExports.useEffect(function() {
      sheet.add(styles);
      return function() {
        sheet.remove();
      };
    }, [styles && isDynamic]);
  };
};
var styleSingleton = function() {
  var useStyle = styleHookSingleton();
  var Sheet = function(_a) {
    var styles = _a.styles, dynamic = _a.dynamic;
    useStyle(styles, dynamic);
    return null;
  };
  return Sheet;
};
var zeroGap = {
  left: 0,
  top: 0,
  right: 0,
  gap: 0
};
var parse = function(x2) {
  return parseInt(x2 || "", 10) || 0;
};
var getOffset = function(gapMode) {
  var cs = window.getComputedStyle(document.body);
  var left = cs[gapMode === "padding" ? "paddingLeft" : "marginLeft"];
  var top = cs[gapMode === "padding" ? "paddingTop" : "marginTop"];
  var right = cs[gapMode === "padding" ? "paddingRight" : "marginRight"];
  return [parse(left), parse(top), parse(right)];
};
var getGapWidth = function(gapMode) {
  if (gapMode === void 0) {
    gapMode = "margin";
  }
  if (typeof window === "undefined") {
    return zeroGap;
  }
  var offsets = getOffset(gapMode);
  var documentWidth = document.documentElement.clientWidth;
  var windowWidth = window.innerWidth;
  return {
    left: offsets[0],
    top: offsets[1],
    right: offsets[2],
    gap: Math.max(0, windowWidth - documentWidth + offsets[2] - offsets[0])
  };
};
var Style = styleSingleton();
var lockAttribute = "data-scroll-locked";
var getStyles = function(_a, allowRelative, gapMode, important) {
  var left = _a.left, top = _a.top, right = _a.right, gap = _a.gap;
  if (gapMode === void 0) {
    gapMode = "margin";
  }
  return "\n  .".concat(noScrollbarsClassName, " {\n   overflow: hidden ").concat(important, ";\n   padding-right: ").concat(gap, "px ").concat(important, ";\n  }\n  body[").concat(lockAttribute, "] {\n    overflow: hidden ").concat(important, ";\n    overscroll-behavior: contain;\n    ").concat([
    allowRelative && "position: relative ".concat(important, ";"),
    gapMode === "margin" && "\n    padding-left: ".concat(left, "px;\n    padding-top: ").concat(top, "px;\n    padding-right: ").concat(right, "px;\n    margin-left:0;\n    margin-top:0;\n    margin-right: ").concat(gap, "px ").concat(important, ";\n    "),
    gapMode === "padding" && "padding-right: ".concat(gap, "px ").concat(important, ";")
  ].filter(Boolean).join(""), "\n  }\n  \n  .").concat(zeroRightClassName, " {\n    right: ").concat(gap, "px ").concat(important, ";\n  }\n  \n  .").concat(fullWidthClassName, " {\n    margin-right: ").concat(gap, "px ").concat(important, ";\n  }\n  \n  .").concat(zeroRightClassName, " .").concat(zeroRightClassName, " {\n    right: 0 ").concat(important, ";\n  }\n  \n  .").concat(fullWidthClassName, " .").concat(fullWidthClassName, " {\n    margin-right: 0 ").concat(important, ";\n  }\n  \n  body[").concat(lockAttribute, "] {\n    ").concat(removedBarSizeVariable, ": ").concat(gap, "px;\n  }\n");
};
var getCurrentUseCounter = function() {
  var counter = parseInt(document.body.getAttribute(lockAttribute) || "0", 10);
  return isFinite(counter) ? counter : 0;
};
var useLockAttribute = function() {
  reactExports.useEffect(function() {
    document.body.setAttribute(lockAttribute, (getCurrentUseCounter() + 1).toString());
    return function() {
      var newCounter = getCurrentUseCounter() - 1;
      if (newCounter <= 0) {
        document.body.removeAttribute(lockAttribute);
      } else {
        document.body.setAttribute(lockAttribute, newCounter.toString());
      }
    };
  }, []);
};
var RemoveScrollBar = function(_a) {
  var noRelative = _a.noRelative, noImportant = _a.noImportant, _b = _a.gapMode, gapMode = _b === void 0 ? "margin" : _b;
  useLockAttribute();
  var gap = reactExports.useMemo(function() {
    return getGapWidth(gapMode);
  }, [gapMode]);
  return reactExports.createElement(Style, { styles: getStyles(gap, !noRelative, gapMode, !noImportant ? "!important" : "") });
};
var passiveSupported = false;
if (typeof window !== "undefined") {
  try {
    var options = Object.defineProperty({}, "passive", {
      get: function() {
        passiveSupported = true;
        return true;
      }
    });
    window.addEventListener("test", options, options);
    window.removeEventListener("test", options, options);
  } catch (err) {
    passiveSupported = false;
  }
}
var nonPassive = passiveSupported ? { passive: false } : false;
var alwaysContainsScroll = function(node) {
  return node.tagName === "TEXTAREA";
};
var elementCanBeScrolled = function(node, overflow) {
  if (!(node instanceof Element)) {
    return false;
  }
  var styles = window.getComputedStyle(node);
  return (
    // not-not-scrollable
    styles[overflow] !== "hidden" && // contains scroll inside self
    !(styles.overflowY === styles.overflowX && !alwaysContainsScroll(node) && styles[overflow] === "visible")
  );
};
var elementCouldBeVScrolled = function(node) {
  return elementCanBeScrolled(node, "overflowY");
};
var elementCouldBeHScrolled = function(node) {
  return elementCanBeScrolled(node, "overflowX");
};
var locationCouldBeScrolled = function(axis, node) {
  var ownerDocument = node.ownerDocument;
  var current = node;
  do {
    if (typeof ShadowRoot !== "undefined" && current instanceof ShadowRoot) {
      current = current.host;
    }
    var isScrollable = elementCouldBeScrolled(axis, current);
    if (isScrollable) {
      var _a = getScrollVariables(axis, current), scrollHeight = _a[1], clientHeight = _a[2];
      if (scrollHeight > clientHeight) {
        return true;
      }
    }
    current = current.parentNode;
  } while (current && current !== ownerDocument.body);
  return false;
};
var getVScrollVariables = function(_a) {
  var scrollTop = _a.scrollTop, scrollHeight = _a.scrollHeight, clientHeight = _a.clientHeight;
  return [
    scrollTop,
    scrollHeight,
    clientHeight
  ];
};
var getHScrollVariables = function(_a) {
  var scrollLeft = _a.scrollLeft, scrollWidth = _a.scrollWidth, clientWidth = _a.clientWidth;
  return [
    scrollLeft,
    scrollWidth,
    clientWidth
  ];
};
var elementCouldBeScrolled = function(axis, node) {
  return axis === "v" ? elementCouldBeVScrolled(node) : elementCouldBeHScrolled(node);
};
var getScrollVariables = function(axis, node) {
  return axis === "v" ? getVScrollVariables(node) : getHScrollVariables(node);
};
var getDirectionFactor = function(axis, direction) {
  return axis === "h" && direction === "rtl" ? -1 : 1;
};
var handleScroll = function(axis, endTarget, event, sourceDelta, noOverscroll) {
  var directionFactor = getDirectionFactor(axis, window.getComputedStyle(endTarget).direction);
  var delta = directionFactor * sourceDelta;
  var target = event.target;
  var targetInLock = endTarget.contains(target);
  var shouldCancelScroll = false;
  var isDeltaPositive = delta > 0;
  var availableScroll = 0;
  var availableScrollTop = 0;
  do {
    if (!target) {
      break;
    }
    var _a = getScrollVariables(axis, target), position = _a[0], scroll_1 = _a[1], capacity = _a[2];
    var elementScroll = scroll_1 - capacity - directionFactor * position;
    if (position || elementScroll) {
      if (elementCouldBeScrolled(axis, target)) {
        availableScroll += elementScroll;
        availableScrollTop += position;
      }
    }
    var parent_1 = target.parentNode;
    target = parent_1 && parent_1.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? parent_1.host : parent_1;
  } while (
    // portaled content
    !targetInLock && target !== document.body || // self content
    targetInLock && (endTarget.contains(target) || endTarget === target)
  );
  if (isDeltaPositive && (Math.abs(availableScroll) < 1 || false)) {
    shouldCancelScroll = true;
  } else if (!isDeltaPositive && (Math.abs(availableScrollTop) < 1 || false)) {
    shouldCancelScroll = true;
  }
  return shouldCancelScroll;
};
var getTouchXY = function(event) {
  return "changedTouches" in event ? [event.changedTouches[0].clientX, event.changedTouches[0].clientY] : [0, 0];
};
var getDeltaXY = function(event) {
  return [event.deltaX, event.deltaY];
};
var extractRef = function(ref) {
  return ref && "current" in ref ? ref.current : ref;
};
var deltaCompare = function(x2, y2) {
  return x2[0] === y2[0] && x2[1] === y2[1];
};
var generateStyle = function(id2) {
  return "\n  .block-interactivity-".concat(id2, " {pointer-events: none;}\n  .allow-interactivity-").concat(id2, " {pointer-events: all;}\n");
};
var idCounter = 0;
var lockStack = [];
function RemoveScrollSideCar(props) {
  var shouldPreventQueue = reactExports.useRef([]);
  var touchStartRef = reactExports.useRef([0, 0]);
  var activeAxis = reactExports.useRef();
  var id2 = reactExports.useState(idCounter++)[0];
  var Style2 = reactExports.useState(styleSingleton)[0];
  var lastProps = reactExports.useRef(props);
  reactExports.useEffect(function() {
    lastProps.current = props;
  }, [props]);
  reactExports.useEffect(function() {
    if (props.inert) {
      document.body.classList.add("block-interactivity-".concat(id2));
      var allow_1 = __spreadArray([props.lockRef.current], (props.shards || []).map(extractRef), true).filter(Boolean);
      allow_1.forEach(function(el2) {
        return el2.classList.add("allow-interactivity-".concat(id2));
      });
      return function() {
        document.body.classList.remove("block-interactivity-".concat(id2));
        allow_1.forEach(function(el2) {
          return el2.classList.remove("allow-interactivity-".concat(id2));
        });
      };
    }
    return;
  }, [props.inert, props.lockRef.current, props.shards]);
  var shouldCancelEvent = reactExports.useCallback(function(event, parent) {
    if ("touches" in event && event.touches.length === 2 || event.type === "wheel" && event.ctrlKey) {
      return !lastProps.current.allowPinchZoom;
    }
    var touch = getTouchXY(event);
    var touchStart = touchStartRef.current;
    var deltaX = "deltaX" in event ? event.deltaX : touchStart[0] - touch[0];
    var deltaY = "deltaY" in event ? event.deltaY : touchStart[1] - touch[1];
    var currentAxis;
    var target = event.target;
    var moveDirection = Math.abs(deltaX) > Math.abs(deltaY) ? "h" : "v";
    if ("touches" in event && moveDirection === "h" && target.type === "range") {
      return false;
    }
    var selection = window.getSelection();
    var anchorNode = selection && selection.anchorNode;
    var isTouchingSelection = anchorNode ? anchorNode === target || anchorNode.contains(target) : false;
    if (isTouchingSelection) {
      return false;
    }
    var canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);
    if (!canBeScrolledInMainDirection) {
      return true;
    }
    if (canBeScrolledInMainDirection) {
      currentAxis = moveDirection;
    } else {
      currentAxis = moveDirection === "v" ? "h" : "v";
      canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);
    }
    if (!canBeScrolledInMainDirection) {
      return false;
    }
    if (!activeAxis.current && "changedTouches" in event && (deltaX || deltaY)) {
      activeAxis.current = currentAxis;
    }
    if (!currentAxis) {
      return true;
    }
    var cancelingAxis = activeAxis.current || currentAxis;
    return handleScroll(cancelingAxis, parent, event, cancelingAxis === "h" ? deltaX : deltaY);
  }, []);
  var shouldPrevent = reactExports.useCallback(function(_event) {
    var event = _event;
    if (!lockStack.length || lockStack[lockStack.length - 1] !== Style2) {
      return;
    }
    var delta = "deltaY" in event ? getDeltaXY(event) : getTouchXY(event);
    var sourceEvent = shouldPreventQueue.current.filter(function(e) {
      return e.name === event.type && (e.target === event.target || event.target === e.shadowParent) && deltaCompare(e.delta, delta);
    })[0];
    if (sourceEvent && sourceEvent.should) {
      if (event.cancelable) {
        event.preventDefault();
      }
      return;
    }
    if (!sourceEvent) {
      var shardNodes = (lastProps.current.shards || []).map(extractRef).filter(Boolean).filter(function(node) {
        return node.contains(event.target);
      });
      var shouldStop = shardNodes.length > 0 ? shouldCancelEvent(event, shardNodes[0]) : !lastProps.current.noIsolation;
      if (shouldStop) {
        if (event.cancelable) {
          event.preventDefault();
        }
      }
    }
  }, []);
  var shouldCancel = reactExports.useCallback(function(name, delta, target, should) {
    var event = { name, delta, target, should, shadowParent: getOutermostShadowParent(target) };
    shouldPreventQueue.current.push(event);
    setTimeout(function() {
      shouldPreventQueue.current = shouldPreventQueue.current.filter(function(e) {
        return e !== event;
      });
    }, 1);
  }, []);
  var scrollTouchStart = reactExports.useCallback(function(event) {
    touchStartRef.current = getTouchXY(event);
    activeAxis.current = void 0;
  }, []);
  var scrollWheel = reactExports.useCallback(function(event) {
    shouldCancel(event.type, getDeltaXY(event), event.target, shouldCancelEvent(event, props.lockRef.current));
  }, []);
  var scrollTouchMove = reactExports.useCallback(function(event) {
    shouldCancel(event.type, getTouchXY(event), event.target, shouldCancelEvent(event, props.lockRef.current));
  }, []);
  reactExports.useEffect(function() {
    lockStack.push(Style2);
    props.setCallbacks({
      onScrollCapture: scrollWheel,
      onWheelCapture: scrollWheel,
      onTouchMoveCapture: scrollTouchMove
    });
    document.addEventListener("wheel", shouldPrevent, nonPassive);
    document.addEventListener("touchmove", shouldPrevent, nonPassive);
    document.addEventListener("touchstart", scrollTouchStart, nonPassive);
    return function() {
      lockStack = lockStack.filter(function(inst) {
        return inst !== Style2;
      });
      document.removeEventListener("wheel", shouldPrevent, nonPassive);
      document.removeEventListener("touchmove", shouldPrevent, nonPassive);
      document.removeEventListener("touchstart", scrollTouchStart, nonPassive);
    };
  }, []);
  var removeScrollBar = props.removeScrollBar, inert = props.inert;
  return reactExports.createElement(
    reactExports.Fragment,
    null,
    inert ? reactExports.createElement(Style2, { styles: generateStyle(id2) }) : null,
    removeScrollBar ? reactExports.createElement(RemoveScrollBar, { noRelative: props.noRelative, gapMode: props.gapMode }) : null
  );
}
function getOutermostShadowParent(node) {
  var shadowParent = null;
  while (node !== null) {
    if (node instanceof ShadowRoot) {
      shadowParent = node.host;
      node = node.host;
    }
    node = node.parentNode;
  }
  return shadowParent;
}
const SideCar = exportSidecar(effectCar, RemoveScrollSideCar);
var ReactRemoveScroll = reactExports.forwardRef(function(props, ref) {
  return reactExports.createElement(RemoveScroll, __assign({}, props, { ref, sideCar: SideCar }));
});
ReactRemoveScroll.classNames = RemoveScroll.classNames;
var getDefaultParent = function(originalTarget) {
  if (typeof document === "undefined") {
    return null;
  }
  var sampleTarget = Array.isArray(originalTarget) ? originalTarget[0] : originalTarget;
  return sampleTarget.ownerDocument.body;
};
var counterMap = /* @__PURE__ */ new WeakMap();
var uncontrolledNodes = /* @__PURE__ */ new WeakMap();
var markerMap = {};
var lockCount = 0;
var unwrapHost = function(node) {
  return node && (node.host || unwrapHost(node.parentNode));
};
var correctTargets = function(parent, targets) {
  return targets.map(function(target) {
    if (parent.contains(target)) {
      return target;
    }
    var correctedTarget = unwrapHost(target);
    if (correctedTarget && parent.contains(correctedTarget)) {
      return correctedTarget;
    }
    console.error("aria-hidden", target, "in not contained inside", parent, ". Doing nothing");
    return null;
  }).filter(function(x2) {
    return Boolean(x2);
  });
};
var applyAttributeToOthers = function(originalTarget, parentNode, markerName, controlAttribute) {
  var targets = correctTargets(parentNode, Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
  if (!markerMap[markerName]) {
    markerMap[markerName] = /* @__PURE__ */ new WeakMap();
  }
  var markerCounter = markerMap[markerName];
  var hiddenNodes = [];
  var elementsToKeep = /* @__PURE__ */ new Set();
  var elementsToStop = new Set(targets);
  var keep = function(el2) {
    if (!el2 || elementsToKeep.has(el2)) {
      return;
    }
    elementsToKeep.add(el2);
    keep(el2.parentNode);
  };
  targets.forEach(keep);
  var deep = function(parent) {
    if (!parent || elementsToStop.has(parent)) {
      return;
    }
    Array.prototype.forEach.call(parent.children, function(node) {
      if (elementsToKeep.has(node)) {
        deep(node);
      } else {
        try {
          var attr = node.getAttribute(controlAttribute);
          var alreadyHidden = attr !== null && attr !== "false";
          var counterValue = (counterMap.get(node) || 0) + 1;
          var markerValue = (markerCounter.get(node) || 0) + 1;
          counterMap.set(node, counterValue);
          markerCounter.set(node, markerValue);
          hiddenNodes.push(node);
          if (counterValue === 1 && alreadyHidden) {
            uncontrolledNodes.set(node, true);
          }
          if (markerValue === 1) {
            node.setAttribute(markerName, "true");
          }
          if (!alreadyHidden) {
            node.setAttribute(controlAttribute, "true");
          }
        } catch (e) {
          console.error("aria-hidden: cannot operate on ", node, e);
        }
      }
    });
  };
  deep(parentNode);
  elementsToKeep.clear();
  lockCount++;
  return function() {
    hiddenNodes.forEach(function(node) {
      var counterValue = counterMap.get(node) - 1;
      var markerValue = markerCounter.get(node) - 1;
      counterMap.set(node, counterValue);
      markerCounter.set(node, markerValue);
      if (!counterValue) {
        if (!uncontrolledNodes.has(node)) {
          node.removeAttribute(controlAttribute);
        }
        uncontrolledNodes.delete(node);
      }
      if (!markerValue) {
        node.removeAttribute(markerName);
      }
    });
    lockCount--;
    if (!lockCount) {
      counterMap = /* @__PURE__ */ new WeakMap();
      counterMap = /* @__PURE__ */ new WeakMap();
      uncontrolledNodes = /* @__PURE__ */ new WeakMap();
      markerMap = {};
    }
  };
};
var hideOthers = function(originalTarget, parentNode, markerName) {
  if (markerName === void 0) {
    markerName = "data-aria-hidden";
  }
  var targets = Array.from(Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
  var activeParentNode = getDefaultParent(originalTarget);
  if (!activeParentNode) {
    return function() {
      return null;
    };
  }
  targets.push.apply(targets, Array.from(activeParentNode.querySelectorAll("[aria-live], script")));
  return applyAttributeToOthers(targets, activeParentNode, markerName, "aria-hidden");
};
// @__NO_SIDE_EFFECTS__
function createSlot$2(ownerName) {
  const SlotClone = /* @__PURE__ */ createSlotClone$2(ownerName);
  const Slot2 = reactExports.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    const childrenArray = reactExports.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable$2);
    if (slottable) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) => {
        if (child === slottable) {
          if (reactExports.Children.count(newElement) > 1) return reactExports.Children.only(null);
          return reactExports.isValidElement(newElement) ? newElement.props.children : null;
        } else {
          return child;
        }
      });
      return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children: reactExports.isValidElement(newElement) ? reactExports.cloneElement(newElement, void 0, newChildren) : null });
    }
    return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children });
  });
  Slot2.displayName = `${ownerName}.Slot`;
  return Slot2;
}
// @__NO_SIDE_EFFECTS__
function createSlotClone$2(ownerName) {
  const SlotClone = reactExports.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    if (reactExports.isValidElement(children)) {
      const childrenRef = getElementRef$2(children);
      const props2 = mergeProps$2(slotProps, children.props);
      if (children.type !== reactExports.Fragment) {
        props2.ref = forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef;
      }
      return reactExports.cloneElement(children, props2);
    }
    return reactExports.Children.count(children) > 1 ? reactExports.Children.only(null) : null;
  });
  SlotClone.displayName = `${ownerName}.SlotClone`;
  return SlotClone;
}
var SLOTTABLE_IDENTIFIER$2 = Symbol("radix.slottable");
function isSlottable$2(child) {
  return reactExports.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER$2;
}
function mergeProps$2(slotProps, childProps) {
  const overrideProps = { ...childProps };
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];
    const isHandler = /^on[A-Z]/.test(propName);
    if (isHandler) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args) => {
          const result = childPropValue(...args);
          slotPropValue(...args);
          return result;
        };
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    } else if (propName === "style") {
      overrideProps[propName] = { ...slotPropValue, ...childPropValue };
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
    }
  }
  return { ...slotProps, ...overrideProps };
}
function getElementRef$2(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.ref;
  }
  getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
  mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.props.ref;
  }
  return element.props.ref || element.ref;
}
var DIALOG_NAME = "Dialog";
var [createDialogContext] = createContextScope(DIALOG_NAME);
var [DialogProvider, useDialogContext] = createDialogContext(DIALOG_NAME);
var Dialog$1 = (props) => {
  const {
    __scopeDialog,
    children,
    open: openProp,
    defaultOpen,
    onOpenChange,
    modal = true
  } = props;
  const triggerRef = reactExports.useRef(null);
  const contentRef = reactExports.useRef(null);
  const [open, setOpen] = useControllableState({
    prop: openProp,
    defaultProp: defaultOpen ?? false,
    onChange: onOpenChange,
    caller: DIALOG_NAME
  });
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    DialogProvider,
    {
      scope: __scopeDialog,
      triggerRef,
      contentRef,
      contentId: useId(),
      titleId: useId(),
      descriptionId: useId(),
      open,
      onOpenChange: setOpen,
      onOpenToggle: reactExports.useCallback(() => setOpen((prevOpen) => !prevOpen), [setOpen]),
      modal,
      children
    }
  );
};
Dialog$1.displayName = DIALOG_NAME;
var TRIGGER_NAME = "DialogTrigger";
var DialogTrigger$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeDialog, ...triggerProps } = props;
    const context = useDialogContext(TRIGGER_NAME, __scopeDialog);
    const composedTriggerRef = useComposedRefs(forwardedRef, context.triggerRef);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Primitive.button,
      {
        type: "button",
        "aria-haspopup": "dialog",
        "aria-expanded": context.open,
        "aria-controls": context.contentId,
        "data-state": getState(context.open),
        ...triggerProps,
        ref: composedTriggerRef,
        onClick: composeEventHandlers(props.onClick, context.onOpenToggle)
      }
    );
  }
);
DialogTrigger$1.displayName = TRIGGER_NAME;
var PORTAL_NAME = "DialogPortal";
var [PortalProvider, usePortalContext] = createDialogContext(PORTAL_NAME, {
  forceMount: void 0
});
var DialogPortal$1 = (props) => {
  const { __scopeDialog, forceMount, children, container } = props;
  const context = useDialogContext(PORTAL_NAME, __scopeDialog);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(PortalProvider, { scope: __scopeDialog, forceMount, children: reactExports.Children.map(children, (child) => /* @__PURE__ */ jsxRuntimeExports.jsx(Presence, { present: forceMount || context.open, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Portal$1, { asChild: true, container, children: child }) })) });
};
DialogPortal$1.displayName = PORTAL_NAME;
var OVERLAY_NAME = "DialogOverlay";
var DialogOverlay$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const portalContext = usePortalContext(OVERLAY_NAME, props.__scopeDialog);
    const { forceMount = portalContext.forceMount, ...overlayProps } = props;
    const context = useDialogContext(OVERLAY_NAME, props.__scopeDialog);
    return context.modal ? /* @__PURE__ */ jsxRuntimeExports.jsx(Presence, { present: forceMount || context.open, children: /* @__PURE__ */ jsxRuntimeExports.jsx(DialogOverlayImpl, { ...overlayProps, ref: forwardedRef }) }) : null;
  }
);
DialogOverlay$1.displayName = OVERLAY_NAME;
var Slot$1 = /* @__PURE__ */ createSlot$2("DialogOverlay.RemoveScroll");
var DialogOverlayImpl = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeDialog, ...overlayProps } = props;
    const context = useDialogContext(OVERLAY_NAME, __scopeDialog);
    return (
      // Make sure `Content` is scrollable even when it doesn't live inside `RemoveScroll`
      // ie. when `Overlay` and `Content` are siblings
      /* @__PURE__ */ jsxRuntimeExports.jsx(ReactRemoveScroll, { as: Slot$1, allowPinchZoom: true, shards: [context.contentRef], children: /* @__PURE__ */ jsxRuntimeExports.jsx(
        Primitive.div,
        {
          "data-state": getState(context.open),
          ...overlayProps,
          ref: forwardedRef,
          style: { pointerEvents: "auto", ...overlayProps.style }
        }
      ) })
    );
  }
);
var CONTENT_NAME = "DialogContent";
var DialogContent$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const portalContext = usePortalContext(CONTENT_NAME, props.__scopeDialog);
    const { forceMount = portalContext.forceMount, ...contentProps } = props;
    const context = useDialogContext(CONTENT_NAME, props.__scopeDialog);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Presence, { present: forceMount || context.open, children: context.modal ? /* @__PURE__ */ jsxRuntimeExports.jsx(DialogContentModal, { ...contentProps, ref: forwardedRef }) : /* @__PURE__ */ jsxRuntimeExports.jsx(DialogContentNonModal, { ...contentProps, ref: forwardedRef }) });
  }
);
DialogContent$1.displayName = CONTENT_NAME;
var DialogContentModal = reactExports.forwardRef(
  (props, forwardedRef) => {
    const context = useDialogContext(CONTENT_NAME, props.__scopeDialog);
    const contentRef = reactExports.useRef(null);
    const composedRefs = useComposedRefs(forwardedRef, context.contentRef, contentRef);
    reactExports.useEffect(() => {
      const content = contentRef.current;
      if (content) return hideOthers(content);
    }, []);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      DialogContentImpl,
      {
        ...props,
        ref: composedRefs,
        trapFocus: context.open,
        disableOutsidePointerEvents: true,
        onCloseAutoFocus: composeEventHandlers(props.onCloseAutoFocus, (event) => {
          event.preventDefault();
          context.triggerRef.current?.focus();
        }),
        onPointerDownOutside: composeEventHandlers(props.onPointerDownOutside, (event) => {
          const originalEvent = event.detail.originalEvent;
          const ctrlLeftClick = originalEvent.button === 0 && originalEvent.ctrlKey === true;
          const isRightClick = originalEvent.button === 2 || ctrlLeftClick;
          if (isRightClick) event.preventDefault();
        }),
        onFocusOutside: composeEventHandlers(
          props.onFocusOutside,
          (event) => event.preventDefault()
        )
      }
    );
  }
);
var DialogContentNonModal = reactExports.forwardRef(
  (props, forwardedRef) => {
    const context = useDialogContext(CONTENT_NAME, props.__scopeDialog);
    const hasInteractedOutsideRef = reactExports.useRef(false);
    const hasPointerDownOutsideRef = reactExports.useRef(false);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      DialogContentImpl,
      {
        ...props,
        ref: forwardedRef,
        trapFocus: false,
        disableOutsidePointerEvents: false,
        onCloseAutoFocus: (event) => {
          props.onCloseAutoFocus?.(event);
          if (!event.defaultPrevented) {
            if (!hasInteractedOutsideRef.current) context.triggerRef.current?.focus();
            event.preventDefault();
          }
          hasInteractedOutsideRef.current = false;
          hasPointerDownOutsideRef.current = false;
        },
        onInteractOutside: (event) => {
          props.onInteractOutside?.(event);
          if (!event.defaultPrevented) {
            hasInteractedOutsideRef.current = true;
            if (event.detail.originalEvent.type === "pointerdown") {
              hasPointerDownOutsideRef.current = true;
            }
          }
          const target = event.target;
          const targetIsTrigger = context.triggerRef.current?.contains(target);
          if (targetIsTrigger) event.preventDefault();
          if (event.detail.originalEvent.type === "focusin" && hasPointerDownOutsideRef.current) {
            event.preventDefault();
          }
        }
      }
    );
  }
);
var DialogContentImpl = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeDialog, trapFocus, onOpenAutoFocus, onCloseAutoFocus, ...contentProps } = props;
    const context = useDialogContext(CONTENT_NAME, __scopeDialog);
    const contentRef = reactExports.useRef(null);
    const composedRefs = useComposedRefs(forwardedRef, contentRef);
    useFocusGuards();
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        FocusScope,
        {
          asChild: true,
          loop: true,
          trapped: trapFocus,
          onMountAutoFocus: onOpenAutoFocus,
          onUnmountAutoFocus: onCloseAutoFocus,
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            DismissableLayer,
            {
              role: "dialog",
              id: context.contentId,
              "aria-describedby": context.descriptionId,
              "aria-labelledby": context.titleId,
              "data-state": getState(context.open),
              ...contentProps,
              ref: composedRefs,
              onDismiss: () => context.onOpenChange(false)
            }
          )
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(TitleWarning, { titleId: context.titleId }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DescriptionWarning, { contentRef, descriptionId: context.descriptionId })
      ] })
    ] });
  }
);
var TITLE_NAME$1 = "DialogTitle";
var DialogTitle$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeDialog, ...titleProps } = props;
    const context = useDialogContext(TITLE_NAME$1, __scopeDialog);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.h2, { id: context.titleId, ...titleProps, ref: forwardedRef });
  }
);
DialogTitle$1.displayName = TITLE_NAME$1;
var DESCRIPTION_NAME$1 = "DialogDescription";
var DialogDescription$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeDialog, ...descriptionProps } = props;
    const context = useDialogContext(DESCRIPTION_NAME$1, __scopeDialog);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.p, { id: context.descriptionId, ...descriptionProps, ref: forwardedRef });
  }
);
DialogDescription$1.displayName = DESCRIPTION_NAME$1;
var CLOSE_NAME$1 = "DialogClose";
var DialogClose = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeDialog, ...closeProps } = props;
    const context = useDialogContext(CLOSE_NAME$1, __scopeDialog);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Primitive.button,
      {
        type: "button",
        ...closeProps,
        ref: forwardedRef,
        onClick: composeEventHandlers(props.onClick, () => context.onOpenChange(false))
      }
    );
  }
);
DialogClose.displayName = CLOSE_NAME$1;
function getState(open) {
  return open ? "open" : "closed";
}
var TITLE_WARNING_NAME = "DialogTitleWarning";
var [WarningProvider, useWarningContext] = createContext2(TITLE_WARNING_NAME, {
  contentName: CONTENT_NAME,
  titleName: TITLE_NAME$1,
  docsSlug: "dialog"
});
var TitleWarning = ({ titleId }) => {
  const titleWarningContext = useWarningContext(TITLE_WARNING_NAME);
  const MESSAGE = `\`${titleWarningContext.contentName}\` requires a \`${titleWarningContext.titleName}\` for the component to be accessible for screen reader users.

If you want to hide the \`${titleWarningContext.titleName}\`, you can wrap it with our VisuallyHidden component.

For more information, see https://radix-ui.com/primitives/docs/components/${titleWarningContext.docsSlug}`;
  reactExports.useEffect(() => {
    if (titleId) {
      const hasTitle = document.getElementById(titleId);
      if (!hasTitle) console.error(MESSAGE);
    }
  }, [MESSAGE, titleId]);
  return null;
};
var DESCRIPTION_WARNING_NAME = "DialogDescriptionWarning";
var DescriptionWarning = ({ contentRef, descriptionId }) => {
  const descriptionWarningContext = useWarningContext(DESCRIPTION_WARNING_NAME);
  const MESSAGE = `Warning: Missing \`Description\` or \`aria-describedby={undefined}\` for {${descriptionWarningContext.contentName}}.`;
  reactExports.useEffect(() => {
    const describedById = contentRef.current?.getAttribute("aria-describedby");
    if (descriptionId && describedById) {
      const hasDescription = document.getElementById(descriptionId);
      if (!hasDescription) console.warn(MESSAGE);
    }
  }, [MESSAGE, contentRef, descriptionId]);
  return null;
};
var Root$1 = Dialog$1;
var Trigger = DialogTrigger$1;
var Portal = DialogPortal$1;
var Overlay = DialogOverlay$1;
var Content = DialogContent$1;
var Title$1 = DialogTitle$1;
var Description$1 = DialogDescription$1;
var Close$1 = DialogClose;
const Dialog = Root$1;
const DialogTrigger = Trigger;
const DialogPortal = Portal;
const DialogOverlay = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Overlay,
  {
    ref,
    className: cn(
      "fixed inset-0 z-50 bg-[var(--overlay-bg)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    ),
    ...props
  }
));
DialogOverlay.displayName = Overlay.displayName;
const DialogContent = reactExports.forwardRef(({ className, children, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogPortal, { children: [
  /* @__PURE__ */ jsxRuntimeExports.jsx(DialogOverlay, {}),
  /* @__PURE__ */ jsxRuntimeExports.jsxs(
    Content,
    {
      ref,
      className: cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      ),
      ...props,
      children: [
        children,
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Close$1, { className: "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(X, { className: "h-4 w-4" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sr-only", children: "Close" })
        ] })
      ]
    }
  )
] }));
DialogContent.displayName = Content.displayName;
const DialogHeader = ({
  className,
  ...props
}) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  "div",
  {
    className: cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    ),
    ...props
  }
);
DialogHeader.displayName = "DialogHeader";
const DialogFooter = ({
  className,
  ...props
}) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  "div",
  {
    className: cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    ),
    ...props
  }
);
DialogFooter.displayName = "DialogFooter";
const DialogTitle = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Title$1,
  {
    ref,
    className: cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    ),
    ...props
  }
));
DialogTitle.displayName = Title$1.displayName;
const DialogDescription = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Description$1,
  {
    ref,
    className: cn("text-sm text-muted-foreground", className),
    ...props
  }
));
DialogDescription.displayName = Description$1.displayName;
var REACT_LAZY_TYPE = Symbol.for("react.lazy");
var use = React$2[" use ".trim().toString()];
function isPromiseLike(value) {
  return typeof value === "object" && value !== null && "then" in value;
}
function isLazyComponent(element) {
  return element != null && typeof element === "object" && "$$typeof" in element && element.$$typeof === REACT_LAZY_TYPE && "_payload" in element && isPromiseLike(element._payload);
}
// @__NO_SIDE_EFFECTS__
function createSlot$1(ownerName) {
  const SlotClone = /* @__PURE__ */ createSlotClone$1(ownerName);
  const Slot2 = reactExports.forwardRef((props, forwardedRef) => {
    let { children, ...slotProps } = props;
    if (isLazyComponent(children) && typeof use === "function") {
      children = use(children._payload);
    }
    const childrenArray = reactExports.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable$1);
    if (slottable) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) => {
        if (child === slottable) {
          if (reactExports.Children.count(newElement) > 1) return reactExports.Children.only(null);
          return reactExports.isValidElement(newElement) ? newElement.props.children : null;
        } else {
          return child;
        }
      });
      return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children: reactExports.isValidElement(newElement) ? reactExports.cloneElement(newElement, void 0, newChildren) : null });
    }
    return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children });
  });
  Slot2.displayName = `${ownerName}.Slot`;
  return Slot2;
}
var Slot = /* @__PURE__ */ createSlot$1("Slot");
// @__NO_SIDE_EFFECTS__
function createSlotClone$1(ownerName) {
  const SlotClone = reactExports.forwardRef((props, forwardedRef) => {
    let { children, ...slotProps } = props;
    if (isLazyComponent(children) && typeof use === "function") {
      children = use(children._payload);
    }
    if (reactExports.isValidElement(children)) {
      const childrenRef = getElementRef$1(children);
      const props2 = mergeProps$1(slotProps, children.props);
      if (children.type !== reactExports.Fragment) {
        props2.ref = forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef;
      }
      return reactExports.cloneElement(children, props2);
    }
    return reactExports.Children.count(children) > 1 ? reactExports.Children.only(null) : null;
  });
  SlotClone.displayName = `${ownerName}.SlotClone`;
  return SlotClone;
}
var SLOTTABLE_IDENTIFIER$1 = Symbol("radix.slottable");
function isSlottable$1(child) {
  return reactExports.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER$1;
}
function mergeProps$1(slotProps, childProps) {
  const overrideProps = { ...childProps };
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];
    const isHandler = /^on[A-Z]/.test(propName);
    if (isHandler) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args) => {
          const result = childPropValue(...args);
          slotPropValue(...args);
          return result;
        };
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    } else if (propName === "style") {
      overrideProps[propName] = { ...slotPropValue, ...childPropValue };
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
    }
  }
  return { ...slotProps, ...overrideProps };
}
function getElementRef$1(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.ref;
  }
  getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
  mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.props.ref;
  }
  return element.props.ref || element.ref;
}
const falsyToString = (value) => typeof value === "boolean" ? `${value}` : value === 0 ? "0" : value;
const cx = clsx;
const cva = (base, config) => (props) => {
  var _config_compoundVariants;
  if ((config === null || config === void 0 ? void 0 : config.variants) == null) return cx(base, props === null || props === void 0 ? void 0 : props.class, props === null || props === void 0 ? void 0 : props.className);
  const { variants, defaultVariants } = config;
  const getVariantClassNames = Object.keys(variants).map((variant) => {
    const variantProp = props === null || props === void 0 ? void 0 : props[variant];
    const defaultVariantProp = defaultVariants === null || defaultVariants === void 0 ? void 0 : defaultVariants[variant];
    if (variantProp === null) return null;
    const variantKey = falsyToString(variantProp) || falsyToString(defaultVariantProp);
    return variants[variant][variantKey];
  });
  const propsWithoutUndefined = props && Object.entries(props).reduce((acc, param) => {
    let [key, value] = param;
    if (value === void 0) {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
  const getCompoundVariantClassNames = config === null || config === void 0 ? void 0 : (_config_compoundVariants = config.compoundVariants) === null || _config_compoundVariants === void 0 ? void 0 : _config_compoundVariants.reduce((acc, param) => {
    let { class: cvClass, className: cvClassName, ...compoundVariantOptions } = param;
    return Object.entries(compoundVariantOptions).every((param2) => {
      let [key, value] = param2;
      return Array.isArray(value) ? value.includes({
        ...defaultVariants,
        ...propsWithoutUndefined
      }[key]) : {
        ...defaultVariants,
        ...propsWithoutUndefined
      }[key] === value;
    }) ? [
      ...acc,
      cvClass,
      cvClassName
    ] : acc;
  }, []);
  return cx(base, getVariantClassNames, getCompoundVariantClassNames, props === null || props === void 0 ? void 0 : props.class, props === null || props === void 0 ? void 0 : props.className);
};
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-[var(--surface-highlight),var(--shadow-xs)] hover:bg-[var(--button-primary-hover)]",
        destructive: "bg-[var(--error)] text-[var(--text-on-accent)] hover:bg-[var(--button-destructive-hover)]",
        outline: "border border-[var(--glass-border)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-hover)] hover:border-[var(--glass-border-hover)]",
        secondary: "bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--glass-border)] hover:bg-[var(--bg-elevated)]",
        ghost: "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        link: "text-[var(--accent-primary)] underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-2.5 text-meta",
        lg: "h-10 px-5",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
const Button = reactExports.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Comp,
      {
        className: cn(buttonVariants({ variant, size, className })),
        ref,
        ...props
      }
    );
  }
);
Button.displayName = "Button";
const navItems = [
  { titleKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
  { titleKey: "nav.providers", href: "/providers", icon: Server },
  { titleKey: "nav.aggregate", href: "/aggregate", icon: Boxes },
  { titleKey: "nav.channels", href: "/channels", icon: KeyRound },
  { titleKey: "nav.proxy", href: "/proxy", icon: Settings2 },
  { titleKey: "nav.models", href: "/models", icon: Cpu },
  { titleKey: "nav.logs", href: "/logs", icon: FileText },
  { titleKey: "nav.settings", href: "/settings", icon: Settings$1 }
];
function NavButton({
  item,
  collapsed,
  onNavigate,
  hasBlockers,
  isCurrent
}) {
  const { t: t2 } = useTranslation();
  const title = t2(item.titleKey);
  const link = /* @__PURE__ */ jsxRuntimeExports.jsxs(
    NavLink,
    {
      to: item.href,
      "aria-label": title,
      onClick: (event) => {
        if (hasBlockers && !isCurrent) {
          event.preventDefault();
          onNavigate(item.href);
        }
      },
      className: ({ isActive }) => cn(
        "sidebar-nav-item",
        collapsed ? "collapsed" : "expanded",
        isActive ? "active" : "inactive"
      ),
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(item.icon, { className: "h-[18px] w-[18px] flex-shrink-0" }),
        !collapsed && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate", children: title })
      ]
    }
  );
  if (!collapsed) return link;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tooltip-container", children: [
    link,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tooltip-content", role: "tooltip", children: title })
  ] });
}
function Sidebar() {
  const { t: t2 } = useTranslation();
  const { sidebarCollapsed, toggleSidebar } = useSettingsStore();
  const { blockers, isDialogOpen, setPendingNavigation, confirmNavigation, cancelNavigation } = useNavigationStore();
  const navigate = useNavigate();
  const location2 = useLocation();
  const shellBridge2 = window.modelportShell;
  const canManageGateways = typeof shellBridge2?.gateways?.snapshot === "function";
  const hasBlockers = blockers.length > 0;
  const handleNavigation = (href) => {
    if (hasBlockers && location2.pathname !== href) {
      setPendingNavigation(() => navigate(href));
    } else {
      navigate(href);
    }
  };
  const handleCancelNavigation = () => {
    cancelNavigation();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "aside",
      {
        className: cn(
          "glass-sidebar flex shrink-0 flex-col transition-[width] duration-200 ease-out",
          sidebarCollapsed ? "w-16" : "w-[232px]"
        ),
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "div",
            {
              className: cn(
                "drag-region flex h-12 items-center border-b border-[var(--glass-border)]",
                sidebarCollapsed ? "justify-center px-2" : "gap-2.5 px-3"
              ),
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sidebar-logo-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Zap, { className: "h-3.5 w-3.5" }) }),
                !sidebarCollapsed && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sidebar-wordmark", children: "ModelPort" })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("nav", { className: "flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 py-2", children: [
            navItems.map((item) => /* @__PURE__ */ jsxRuntimeExports.jsx(
              NavButton,
              {
                item,
                collapsed: sidebarCollapsed,
                onNavigate: handleNavigation,
                hasBlockers,
                isCurrent: location2.pathname === item.href || item.href !== "/" && location2.pathname.startsWith(`${item.href}/`)
              },
              item.href
            )),
            canManageGateways && /* @__PURE__ */ jsxRuntimeExports.jsx(
              NavButton,
              {
                item: { titleKey: "nav.gatewayManager", href: "/gateways", icon: Network },
                collapsed: sidebarCollapsed,
                onNavigate: handleNavigation,
                hasBlockers,
                isCurrent: location2.pathname === "/gateways"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "border-t border-[var(--glass-border)] p-2", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: cn("flex", sidebarCollapsed ? "justify-center" : "justify-end"), children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              className: "sidebar-collapse-btn",
              onClick: toggleSidebar,
              "aria-label": sidebarCollapsed ? t2("settings.expandSidebar") : t2("settings.collapseSidebar"),
              title: sidebarCollapsed ? t2("settings.expandSidebar") : t2("settings.collapseSidebar"),
              children: sidebarCollapsed ? /* @__PURE__ */ jsxRuntimeExports.jsx(PanelLeftOpen, { className: "h-4 w-4" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(PanelLeftClose, { className: "h-4 w-4" })
            }
          ) }) })
        ]
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: isDialogOpen, onOpenChange: (open) => !open && handleCancelNavigation(), children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "sm:max-w-[425px]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogTitle, { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "h-5 w-5 text-[var(--warning)]" }),
          t2("proxy.unsavedChangesTitle")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: blockers[0]?.message || t2("proxy.unsavedChangesDescription") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { className: "gap-2 sm:gap-0", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: handleCancelNavigation, children: t2("common.cancel") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "destructive", onClick: confirmNavigation, children: t2("proxy.discardAndLeave") })
      ] })
    ] }) })
  ] });
}
function applyTitleBarTheme(dark) {
  const pending = window.electronAPI?.app?.setTitleBarTheme?.(dark ? "dark" : "light");
  pending?.catch((cause) => {
    if (cause?.code !== "desktop-only") throw cause;
  });
}
function useTheme() {
  const { theme, setTheme } = useSettingsStore();
  const isDark = reactExports.useMemo(() => {
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return theme === "dark";
  }, [theme]);
  reactExports.useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      root.setAttribute("data-theme", systemTheme);
    } else {
      root.setAttribute("data-theme", theme);
    }
    applyTitleBarTheme(isDark);
  }, [theme, isDark]);
  reactExports.useEffect(() => {
    if (theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => {
      const root = window.document.documentElement;
      root.setAttribute("data-theme", e.matches ? "dark" : "light");
      applyTitleBarTheme(e.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);
  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };
  return {
    theme,
    setTheme,
    toggleTheme,
    isDark
  };
}
const platform = window.electronAPI?.app?.platform;
const hasCaptionOverlay = platform === "win32" || platform === "linux";
function Header() {
  const { t: t2 } = useTranslation();
  const { toggleTheme, isDark } = useTheme();
  const { language, setLanguage } = useSettingsStore();
  const navigate = useNavigate();
  const [proxyEnabled, setProxyEnabled] = reactExports.useState(false);
  const [proxyLoading, setProxyLoading] = reactExports.useState(false);
  const [port, setPort] = reactExports.useState(8080);
  const [host, setHost] = reactExports.useState("127.0.0.1");
  reactExports.useEffect(() => {
    if (!window.electronAPI?.proxy?.onStatusChanged) return;
    const unsubscribe = window.electronAPI.proxy.onStatusChanged((status) => {
      setProxyEnabled(status.isRunning);
      if (status.port) setPort(status.port);
      setHost(status.host || "127.0.0.1");
    });
    window.electronAPI.proxy.getStatus().then((status) => {
      setProxyEnabled(status.isRunning);
      if (status.port) setPort(status.port);
      setHost(status.host || "127.0.0.1");
    });
    window.electronAPI.config?.get?.().then((config) => {
      if (!config) return;
      setPort(config.proxyPort || 8080);
      setHost(config.proxyHost || "127.0.0.1");
    });
    const unsubscribeConfig = window.electronAPI.config?.onConfigChanged?.((config) => {
      setPort(config.proxyPort || 8080);
      setHost(config.proxyHost || "127.0.0.1");
    });
    return () => {
      unsubscribe();
      unsubscribeConfig?.();
    };
  }, []);
  const handleToggleProxy = async () => {
    if (proxyLoading) return;
    setProxyLoading(true);
    try {
      if (proxyEnabled) {
        await window.electronAPI.proxy.stop();
        setProxyEnabled(false);
      } else {
        await window.electronAPI.proxy.start();
        setProxyEnabled(true);
      }
    } finally {
      setProxyLoading(false);
    }
  };
  const toggleLanguage = () => {
    setLanguage(language === "zh-CN" ? "en-US" : "zh-CN");
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "header",
    {
      className: cn(
        "glass-topbar drag-region flex h-12 shrink-0 items-center justify-between px-4",
        hasCaptionOverlay && "pr-[138px]"
      ),
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "no-drag flex items-center gap-1.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "span",
            {
              className: cn(
                "status-dot",
                proxyLoading ? "animate-pulse bg-[var(--warning)]" : proxyEnabled ? "status-dot-online" : "bg-[var(--text-dim)]"
              )
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              onClick: () => navigate("/proxy"),
              className: cn(
                "rounded-md px-1.5 py-1 font-mono text-meta tabular-nums transition-colors",
                proxyEnabled ? "text-[var(--text-primary)] hover:text-[var(--accent-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              ),
              title: t2("nav.proxy"),
              children: [
                host,
                ":",
                port
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              onClick: handleToggleProxy,
              disabled: proxyLoading,
              className: cn(
                "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                proxyEnabled ? "text-[var(--accent-primary)] hover:bg-[var(--accent-soft-hover)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              ),
              title: proxyEnabled ? t2("proxyStatus.stop") : t2("proxyStatus.start"),
              children: proxyLoading ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-micro leading-none", children: "..." }) : proxyEnabled ? /* @__PURE__ */ jsxRuntimeExports.jsx(Pause, { className: "h-3 w-3" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Play, { className: "h-3 w-3" })
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "no-drag flex items-center gap-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              onClick: toggleTheme,
              className: "flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
              title: isDark ? t2("settings.themeLight") : t2("settings.themeDark"),
              children: isDark ? /* @__PURE__ */ jsxRuntimeExports.jsx(Sun, { className: "h-[15px] w-[15px]" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Moon, { className: "h-[15px] w-[15px]" })
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              onClick: toggleLanguage,
              className: "flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
              title: language === "zh-CN" ? t2("header.switchToEnglish") : t2("header.switchToChinese"),
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(Languages, { className: "h-[15px] w-[15px]" })
            }
          )
        ] })
      ]
    }
  );
}
function redactLocalPaths(value) {
  return value.replace(/[A-Za-z]:\\Users\\[^\\/?'"*\s>]+/gi, "[local path]").replace(/\/(?:home|Users|private\/var\/folders)\/[^/\s"'?]+/g, "[local path]");
}
function redactStack(value) {
  if (!value) return "";
  return redactLocalPaths(value);
}
class ErrorBoundary extends React$1.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }
  render() {
    if (this.state.hasError) {
      return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        padding: "20px",
        fontFamily: "monospace",
        backgroundColor: "#1a1a1a",
        color: "#fff",
        minHeight: "100vh"
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { color: "#ff6b6b" }, children: "Application Error" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { style: {
          backgroundColor: "#2a2a2a",
          padding: "10px",
          borderRadius: "4px",
          overflow: "auto",
          maxWidth: "100%"
        }, children: redactStack(this.state.error?.toString()) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { marginTop: "8px", fontSize: "12px", color: "#888" }, children: "Full details are in the developer console and the app log." }),
        this.state.errorInfo && /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { style: { marginTop: "10px" }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { style: { cursor: "pointer", color: "#888" }, children: "Component Stack" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { style: {
            backgroundColor: "#2a2a2a",
            padding: "10px",
            borderRadius: "4px",
            overflow: "auto",
            maxWidth: "100%",
            fontSize: "12px"
          }, children: redactStack(this.state.errorInfo.componentStack) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            onClick: () => window.location.reload(),
            style: {
              marginTop: "20px",
              padding: "10px 20px",
              backgroundColor: "#4a9eff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer"
            },
            children: "Reload"
          }
        )
      ] });
    }
    return this.props.children;
  }
}
function MainLayout() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex h-screen overflow-hidden bg-[var(--bg-primary)]", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Sidebar, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-w-0 flex-1 flex-col overflow-hidden", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Header, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsx("main", { className: "flex-1 overflow-y-auto", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mx-auto w-full max-w-[1280px] px-6 py-6 lg:px-8", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ErrorBoundary, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Outlet, {}) }) }) })
    ] })
  ] });
}
const useProvidersStore = create((set, get2) => ({
  providers: [],
  builtinProviders: [],
  accounts: [],
  providerStatuses: {},
  accountCounts: {},
  isLoading: false,
  selectedProviderId: null,
  selectedAccountId: null,
  modelsLastUpdated: Date.now(),
  setProviders: (providers2) => set({ providers: providers2 }),
  setBuiltinProviders: (builtinProviders) => set({ builtinProviders }),
  setAccounts: (accounts) => set({ accounts }),
  setProviderStatuses: (providerStatuses) => set({ providerStatuses }),
  setAccountCounts: (accountCounts) => set({ accountCounts }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setSelectedProviderId: (selectedProviderId) => set({ selectedProviderId }),
  setSelectedAccountId: (selectedAccountId) => set({ selectedAccountId }),
  setModelsLastUpdated: (modelsLastUpdated) => set({ modelsLastUpdated }),
  addProvider: (provider) => set((state) => ({
    providers: [...state.providers, provider]
  })),
  updateProvider: (id2, updates) => set((state) => ({
    providers: state.providers.map(
      (p2) => p2.id === id2 ? { ...p2, ...updates } : p2
    )
  })),
  removeProvider: (id2) => set((state) => ({
    providers: state.providers.filter((p2) => p2.id !== id2),
    accounts: state.accounts.filter((a) => a.providerId !== id2)
  })),
  addAccount: (account) => set((state) => ({
    accounts: [...state.accounts, account]
  })),
  updateAccount: (id2, updates) => set((state) => ({
    accounts: state.accounts.map(
      (a) => a.id === id2 ? { ...a, ...updates } : a
    )
  })),
  removeAccount: (id2) => set((state) => ({
    accounts: state.accounts.filter((a) => a.id !== id2)
  })),
  updateProviderStatus: (id2, status) => set((state) => ({
    providerStatuses: {
      ...state.providerStatuses,
      [id2]: status
    }
  })),
  updateAccountCount: (providerId, total, active) => set((state) => ({
    accountCounts: {
      ...state.accountCounts,
      [providerId]: { total, active }
    }
  })),
  getProviderById: (id2) => get2().providers.find((p2) => p2.id === id2),
  getAccountById: (id2) => get2().accounts.find((a) => a.id === id2),
  getAccountsByProvider: (providerId) => get2().accounts.filter((a) => a.providerId === providerId)
}));
function localAccountCounts(providers2, accounts) {
  const counts = {};
  for (const provider of providers2) {
    const own = accounts.filter((account) => account.providerId === provider.id);
    counts[provider.id] = {
      total: own.length,
      active: own.filter((account) => account.status === "active").length
    };
  }
  return counts;
}
function mergeChannelCounts(counts, providers2, pool) {
  const merged = { ...counts };
  for (const provider of providers2) {
    if (provider.type !== "account") continue;
    const poolCount = pool[provider.id];
    if (poolCount === void 0) continue;
    merged[provider.id] = { total: poolCount.total, active: poolCount.enabled };
  }
  return merged;
}
function isIpv4(value) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function isIpv6(value) {
  if (!value.includes(":")) return false;
  return /^[0-9a-f:.]+$/.test(value);
}
function isDnsName(value) {
  return /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value);
}
function isAllowedSanHost(value) {
  return isIpv4(value) || isIpv6(value) || isDnsName(value);
}
function normalizeSanHostList(input) {
  const raw = Array.isArray(input) ? input : [];
  const out = [];
  for (const entry of raw) {
    for (const piece of String(entry ?? "").split(/[,;\r\n]+/)) {
      const value = piece.trim().toLowerCase();
      if (value === "" || !isAllowedSanHost(value)) continue;
      if (!out.includes(value)) out.push(value);
    }
  }
  return out;
}
function validateSanHosts(input) {
  if (input === void 0) return [];
  if (!Array.isArray(input)) return ["HTTPS certificate names must be a list of IPs or hostnames"];
  const rejected = [];
  for (const entry of input) {
    for (const piece of String(entry ?? "").split(/[,;\r\n]+/)) {
      const value = piece.trim().toLowerCase();
      if (value === "") continue;
      if (!isAllowedSanHost(value)) rejected.push(value);
    }
  }
  return rejected.length > 0 ? [`HTTPS certificate name is neither an IP nor a hostname: ${rejected.join(", ")}`] : [];
}
function formatHostForUrl(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
function buildHttpsUrl(host, port) {
  return `https://${formatHostForUrl(host)}:${port}`;
}
function buildProxyUrl(host, port, https) {
  return `${https ? "https" : "http"}://${formatHostForUrl(host)}:${port}`;
}
const logoIcon = "" + new URL("icons-D8bso406.png", import.meta.url).href;
function TrayView() {
  const { toggleTheme, isDark } = useTheme();
  const { language } = useSettingsStore();
  const { providers: providers2, accounts, setProviders, setAccounts, setIsLoading, isLoading } = useProvidersStore();
  const [proxyRunning, setProxyRunning] = reactExports.useState(false);
  const [proxyLoading, setProxyLoading] = reactExports.useState(false);
  const [port, setPort] = reactExports.useState(8080);
  const [host, setHost] = reactExports.useState("127.0.0.1");
  const [httpsEnabled, setHttpsEnabled] = reactExports.useState(false);
  const [httpsPort, setHttpsPort] = reactExports.useState(8443);
  const [copied, setCopied] = reactExports.useState(false);
  const [isRefreshing, setIsRefreshing] = reactExports.useState(false);
  const [selectedProvider, setSelectedProvider] = reactExports.useState(null);
  const [accountCounts, setAccountCounts] = reactExports.useState({});
  reactExports.useEffect(() => {
    const loadProxyStatus = async () => {
      const status = await window.electronAPI?.proxy?.getStatus?.();
      setProxyRunning(status.isRunning);
      const config = await window.electronAPI?.config?.get?.();
      if (config) {
        setPort(config.proxyPort || 8080);
        setHost(config.proxyHost || "127.0.0.1");
        setHttpsEnabled(config.httpsEnabled ?? false);
        setHttpsPort(config.httpsPort ?? 8443);
      }
    };
    loadProxyStatus();
    const unsubscribeProxy = window.electronAPI?.proxy?.onStatusChanged?.((status) => {
      setProxyRunning(status.isRunning);
      if (status.port) setPort(status.port);
    });
    const unsubscribeConfig = window.electronAPI?.config?.onConfigChanged?.((config) => {
      setPort(config.proxyPort || 8080);
      setHost(config.proxyHost || "127.0.0.1");
      setHttpsEnabled(config.httpsEnabled ?? false);
      setHttpsPort(config.httpsPort ?? 8443);
    });
    return () => {
      unsubscribeProxy?.();
      unsubscribeConfig?.();
    };
  }, []);
  reactExports.useEffect(() => {
    loadData();
  }, []);
  reactExports.useEffect(() => {
    if (!selectedProvider && providers2.length > 0) {
      const firstWithAccounts = providers2.find((p2) => {
        const count2 = accounts.filter((a) => a.providerId === p2.id).length;
        return count2 > 0;
      });
      setSelectedProvider(firstWithAccounts?.id || providers2[0]?.id || null);
    }
  }, [providers2, accounts, selectedProvider]);
  reactExports.useEffect(() => {
    window.electronAPI?.tray?.setHeight?.(460);
  }, []);
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [providersData, accountsData, config] = await Promise.all([
        window.electronAPI?.providers?.getAll?.() || [],
        window.electronAPI?.accounts?.getAll?.() || [],
        window.electronAPI?.config?.get?.()
      ]);
      setProviders(providersData);
      setAccounts(accountsData);
      if (config) {
        setPort(config.proxyPort || 8080);
        setHost(config.proxyHost || "127.0.0.1");
        setHttpsEnabled(config.httpsEnabled ?? false);
        setHttpsPort(config.httpsPort ?? 8443);
      }
      await loadAccountCounts(providersData, accountsData);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  };
  const loadAccountCounts = async (providersData, accountsData) => {
    const local = localAccountCounts(providersData, accountsData);
    let pool = {};
    if (providersData.some((provider) => provider.type === "account")) {
      try {
        pool = await window.electronAPI.channels.accountCounts();
      } catch (error) {
        console.warn("Failed to read channel account counts:", error);
      }
    }
    setAccountCounts(mergeChannelCounts(local, providersData, pool));
  };
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setTimeout(() => setIsRefreshing(false), 1e3);
  };
  const handleCopyUrl = async () => {
    const url = buildProxyUrl(host, httpsEnabled ? httpsPort : port, httpsEnabled);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2e3);
  };
  const toggleProxy = async () => {
    if (proxyLoading) return;
    setProxyLoading(true);
    try {
      if (proxyRunning) {
        await window.electronAPI?.proxy?.stop?.();
        setProxyRunning(false);
      } else {
        await window.electronAPI?.proxy?.start?.();
        setProxyRunning(true);
      }
    } finally {
      setProxyLoading(false);
    }
  };
  const openDashboard = () => {
    window.electronAPI?.tray?.openDashboard?.();
  };
  const quitApp = () => {
    window.electronAPI?.tray?.quitApp?.();
  };
  const providerList = reactExports.useMemo(() => {
    return providers2.map((p2) => {
      const counts = accountCounts[p2.id];
      if (counts !== void 0) {
        return { id: p2.id, name: p2.name, accountCount: counts.total, activeCount: counts.active };
      }
      const providerAccounts = accounts.filter((a) => a.providerId === p2.id);
      return {
        id: p2.id,
        name: p2.name,
        accountCount: providerAccounts.length,
        activeCount: providerAccounts.filter((a) => a.status === "active").length
      };
    });
  }, [providers2, accounts, accountCounts]);
  const selectedProviderAccounts = reactExports.useMemo(() => {
    if (!selectedProvider) return [];
    return accounts.filter((a) => a.providerId === selectedProvider);
  }, [accounts, selectedProvider]);
  const isZh = language === "zh-CN";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "w-full h-[460px] flex flex-col select-none overflow-hidden bg-[var(--bg-primary)]", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute top-0 left-0 right-0 h-6 drag-region z-50" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "div",
      {
        className: cn(
          "flex-none relative overflow-hidden transition-colors",
          proxyRunning ? "bg-[var(--accent-primary)] text-[var(--text-on-accent)]" : "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
        ),
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative px-4 py-4 flex items-center justify-between", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-11 h-11 rounded-[var(--radius-card)] bg-[var(--bg-secondary)] border border-[var(--glass-border)] flex items-center justify-center shadow-[var(--shadow-sm)]", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: logoIcon, alt: "ModelPort", className: "w-8 h-8" }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-title tracking-tight", children: "ModelPort" }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1.5 mt-0.5", children: [
                proxyRunning ? /* @__PURE__ */ jsxRuntimeExports.jsx(Wifi, { size: 12 }) : /* @__PURE__ */ jsxRuntimeExports.jsx(WifiOff, { size: 12 }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-meta font-medium opacity-90", children: proxyRunning ? isZh ? "服务运行中" : "Service Running" : isZh ? "服务已停止" : "Service Stopped" })
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-0.5", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                onClick: handleRefresh,
                disabled: isLoading || isRefreshing,
                className: "p-2 rounded-[var(--radius-control)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-30",
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCw, { size: 15, className: cn((isLoading || isRefreshing) && "animate-spin") })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                onClick: toggleTheme,
                className: "p-2 rounded-[var(--radius-control)] hover:bg-[var(--surface-hover)] transition-colors",
                children: isDark ? /* @__PURE__ */ jsxRuntimeExports.jsx(Sun, { size: 15 }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Moon, { size: 15 })
              }
            )
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx("section", { className: "flex-none px-4 -mt-3 relative z-10 no-drag", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bg-[var(--bg-secondary)] border border-[var(--glass-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-md)] p-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex-1 min-w-0", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1.5 mb-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Zap, { size: 12, className: "text-warning" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-micro text-[var(--text-muted)] uppercase tracking-wider font-semibold", children: "API Endpoint" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            onClick: handleCopyUrl,
            className: "flex items-center gap-1.5 group",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "text-subtitle font-mono font-semibold text-[var(--text-primary)] truncate", children: buildProxyUrl(host, httpsEnabled ? httpsPort : port, httpsEnabled) }),
              copied ? /* @__PURE__ */ jsxRuntimeExports.jsx(Check, { size: 12, className: "text-success flex-shrink-0" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Copy, { size: 12, className: "text-[var(--text-dim)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          onClick: toggleProxy,
          disabled: proxyLoading,
          className: cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-control)] font-semibold text-body transition-colors shadow-[var(--shadow-sm)]",
            proxyRunning ? "bg-[var(--error)] text-[var(--text-on-accent)] hover:bg-[var(--button-destructive-hover)]" : "bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:bg-[var(--button-primary-hover)]"
          ),
          children: [
            proxyRunning ? /* @__PURE__ */ jsxRuntimeExports.jsx(Square, { size: 14, fill: "currentColor" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Play, { size: 14, fill: "currentColor" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: proxyRunning ? isZh ? "停止" : "Stop" : isZh ? "启动" : "Start" })
          ]
        }
      )
    ] }) }) }),
    providerList.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("nav", { className: "flex-none px-4 pt-3 pb-2 no-drag", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide", children: providerList.map((p2) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "button",
      {
        onClick: () => setSelectedProvider(p2.id),
        className: cn(
          "flex-shrink-0 px-3 py-1.5 rounded-full text-meta font-medium transition-colors",
          selectedProvider === p2.id ? "bg-[var(--accent-primary)] text-[var(--text-on-accent)]" : "bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        ),
        children: [
          p2.name,
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ml-1 opacity-70", children: [
            p2.activeCount,
            "/",
            p2.accountCount
          ] })
        ]
      },
      p2.id
    )) }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("main", { className: "flex-1 min-h-0 px-4 overflow-y-auto no-drag", children: isLoading && selectedProviderAccounts.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "py-10 flex items-center justify-center", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-6 h-6 border-2 border-[var(--glass-border)] border-t-[var(--accent-primary)] rounded-full animate-spin" }) }) : selectedProviderAccounts.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "py-10 text-center", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-12 h-12 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mx-auto mb-2", children: /* @__PURE__ */ jsxRuntimeExports.jsx(WifiOff, { size: 20, className: "text-[var(--text-dim)]" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-meta text-[var(--text-muted)]", children: isZh ? "暂无账户" : "No accounts" })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-2 pb-3", children: selectedProviderAccounts.map((account) => {
      const isActive = account.status === "active";
      return /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "div",
        {
          className: cn(
            "flex items-center justify-between p-3 rounded-[var(--radius-card)] border transition-colors",
            isActive ? "bg-[var(--accent-soft)] border-[var(--accent-border)]" : "bg-[var(--surface)] border-[var(--glass-border)]"
          ),
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2.5 min-w-0", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "div",
                {
                  className: cn(
                    "w-2.5 h-2.5 rounded-full flex-shrink-0",
                    isActive ? "bg-[var(--success)]" : "bg-[var(--text-dim)]"
                  )
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-subtitle font-medium text-[var(--text-primary)] truncate", children: account.name || account.email || "Unknown" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: cn("flex-shrink-0", isActive ? "badge-success" : "badge-soft"), children: isActive ? isZh ? "在线" : "Active" : isZh ? "离线" : "Inactive" })
          ]
        },
        account.id
      );
    }) }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("footer", { className: "flex-none p-4 border-t border-[var(--glass-border)] no-drag", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          onClick: openDashboard,
          className: "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius-control)] bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] font-semibold text-body transition-colors shadow-[var(--shadow-sm)]",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(ExternalLink, { size: 15 }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: isZh ? "打开主界面" : "Open Dashboard" })
          ]
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          onClick: quitApp,
          className: "flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[var(--radius-control)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[var(--text-muted)] font-semibold text-body transition-colors border border-[var(--glass-border)]",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Power, { size: 15 }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: isZh ? "退出" : "Quit" })
          ]
        }
      )
    ] }) })
  ] });
}
const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 5e3;
let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}
const toastTimeouts = /* @__PURE__ */ new Map();
const addToRemoveQueue = (toastId) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId
    });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
};
const reducer = (state, action) => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT)
      };
    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map(
          (t2) => t2.id === action.toast.id ? { ...t2, ...action.toast } : t2
        )
      };
    case "DISMISS_TOAST": {
      const { toastId } = action;
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast2) => {
          addToRemoveQueue(toast2.id);
        });
      }
      return {
        ...state,
        toasts: state.toasts.map(
          (t2) => t2.id === toastId || toastId === void 0 ? {
            ...t2,
            open: false
          } : t2
        )
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === void 0) {
        return {
          ...state,
          toasts: []
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t2) => t2.id !== action.toastId)
      };
  }
};
const listeners$1 = [];
let memoryState = { toasts: [] };
function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners$1.forEach((listener) => {
    listener(memoryState);
  });
}
function toast({ ...props }) {
  const id2 = genId();
  const update = (props2) => dispatch({
    type: "UPDATE_TOAST",
    toast: { ...props2, id: id2 }
  });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id2 });
  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id: id2,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      }
    }
  });
  return {
    id: id2,
    dismiss,
    update
  };
}
function useToast() {
  const [state, setState] = reactExports.useState(memoryState);
  reactExports.useEffect(() => {
    listeners$1.push(setState);
    return () => {
      const index = listeners$1.indexOf(setState);
      if (index > -1) {
        listeners$1.splice(index, 1);
      }
    };
  }, [state]);
  return {
    ...state,
    toast,
    dismiss: (toastId) => dispatch({ type: "DISMISS_TOAST", toastId })
  };
}
// @__NO_SIDE_EFFECTS__
function createSlot(ownerName) {
  const SlotClone = /* @__PURE__ */ createSlotClone(ownerName);
  const Slot2 = reactExports.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    const childrenArray = reactExports.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable);
    if (slottable) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) => {
        if (child === slottable) {
          if (reactExports.Children.count(newElement) > 1) return reactExports.Children.only(null);
          return reactExports.isValidElement(newElement) ? newElement.props.children : null;
        } else {
          return child;
        }
      });
      return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children: reactExports.isValidElement(newElement) ? reactExports.cloneElement(newElement, void 0, newChildren) : null });
    }
    return /* @__PURE__ */ jsxRuntimeExports.jsx(SlotClone, { ...slotProps, ref: forwardedRef, children });
  });
  Slot2.displayName = `${ownerName}.Slot`;
  return Slot2;
}
// @__NO_SIDE_EFFECTS__
function createSlotClone(ownerName) {
  const SlotClone = reactExports.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    if (reactExports.isValidElement(children)) {
      const childrenRef = getElementRef(children);
      const props2 = mergeProps(slotProps, children.props);
      if (children.type !== reactExports.Fragment) {
        props2.ref = forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef;
      }
      return reactExports.cloneElement(children, props2);
    }
    return reactExports.Children.count(children) > 1 ? reactExports.Children.only(null) : null;
  });
  SlotClone.displayName = `${ownerName}.SlotClone`;
  return SlotClone;
}
var SLOTTABLE_IDENTIFIER = Symbol("radix.slottable");
function isSlottable(child) {
  return reactExports.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER;
}
function mergeProps(slotProps, childProps) {
  const overrideProps = { ...childProps };
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];
    const isHandler = /^on[A-Z]/.test(propName);
    if (isHandler) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args) => {
          const result = childPropValue(...args);
          slotPropValue(...args);
          return result;
        };
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    } else if (propName === "style") {
      overrideProps[propName] = { ...slotPropValue, ...childPropValue };
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
    }
  }
  return { ...slotProps, ...overrideProps };
}
function getElementRef(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.ref;
  }
  getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
  mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.props.ref;
  }
  return element.props.ref || element.ref;
}
function createCollection(name) {
  const PROVIDER_NAME2 = name + "CollectionProvider";
  const [createCollectionContext, createCollectionScope2] = createContextScope(PROVIDER_NAME2);
  const [CollectionProviderImpl, useCollectionContext] = createCollectionContext(
    PROVIDER_NAME2,
    { collectionRef: { current: null }, itemMap: /* @__PURE__ */ new Map() }
  );
  const CollectionProvider = (props) => {
    const { scope, children } = props;
    const ref = React$1.useRef(null);
    const itemMap = React$1.useRef(/* @__PURE__ */ new Map()).current;
    return /* @__PURE__ */ jsxRuntimeExports.jsx(CollectionProviderImpl, { scope, itemMap, collectionRef: ref, children });
  };
  CollectionProvider.displayName = PROVIDER_NAME2;
  const COLLECTION_SLOT_NAME = name + "CollectionSlot";
  const CollectionSlotImpl = /* @__PURE__ */ createSlot(COLLECTION_SLOT_NAME);
  const CollectionSlot = React$1.forwardRef(
    (props, forwardedRef) => {
      const { scope, children } = props;
      const context = useCollectionContext(COLLECTION_SLOT_NAME, scope);
      const composedRefs = useComposedRefs(forwardedRef, context.collectionRef);
      return /* @__PURE__ */ jsxRuntimeExports.jsx(CollectionSlotImpl, { ref: composedRefs, children });
    }
  );
  CollectionSlot.displayName = COLLECTION_SLOT_NAME;
  const ITEM_SLOT_NAME = name + "CollectionItemSlot";
  const ITEM_DATA_ATTR = "data-radix-collection-item";
  const CollectionItemSlotImpl = /* @__PURE__ */ createSlot(ITEM_SLOT_NAME);
  const CollectionItemSlot = React$1.forwardRef(
    (props, forwardedRef) => {
      const { scope, children, ...itemData } = props;
      const ref = React$1.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, ref);
      const context = useCollectionContext(ITEM_SLOT_NAME, scope);
      React$1.useEffect(() => {
        context.itemMap.set(ref, { ref, ...itemData });
        return () => void context.itemMap.delete(ref);
      });
      return /* @__PURE__ */ jsxRuntimeExports.jsx(CollectionItemSlotImpl, { ...{ [ITEM_DATA_ATTR]: "" }, ref: composedRefs, children });
    }
  );
  CollectionItemSlot.displayName = ITEM_SLOT_NAME;
  function useCollection2(scope) {
    const context = useCollectionContext(name + "CollectionConsumer", scope);
    const getItems = React$1.useCallback(() => {
      const collectionNode = context.collectionRef.current;
      if (!collectionNode) return [];
      const orderedNodes = Array.from(collectionNode.querySelectorAll(`[${ITEM_DATA_ATTR}]`));
      const items = Array.from(context.itemMap.values());
      const orderedItems = items.sort(
        (a, b) => orderedNodes.indexOf(a.ref.current) - orderedNodes.indexOf(b.ref.current)
      );
      return orderedItems;
    }, [context.collectionRef, context.itemMap]);
    return getItems;
  }
  return [
    { Provider: CollectionProvider, Slot: CollectionSlot, ItemSlot: CollectionItemSlot },
    useCollection2,
    createCollectionScope2
  ];
}
var VISUALLY_HIDDEN_STYLES = Object.freeze({
  // See: https://github.com/twbs/bootstrap/blob/main/scss/mixins/_visually-hidden.scss
  position: "absolute",
  border: 0,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  wordWrap: "normal"
});
var NAME = "VisuallyHidden";
var VisuallyHidden = reactExports.forwardRef(
  (props, forwardedRef) => {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Primitive.span,
      {
        ...props,
        ref: forwardedRef,
        style: { ...VISUALLY_HIDDEN_STYLES, ...props.style }
      }
    );
  }
);
VisuallyHidden.displayName = NAME;
var Root = VisuallyHidden;
var PROVIDER_NAME = "ToastProvider";
var [Collection, useCollection, createCollectionScope] = createCollection("Toast");
var [createToastContext] = createContextScope("Toast", [createCollectionScope]);
var [ToastProviderProvider, useToastProviderContext] = createToastContext(PROVIDER_NAME);
var ToastProvider$1 = (props) => {
  const {
    __scopeToast,
    label = "Notification",
    duration = 5e3,
    swipeDirection = "right",
    swipeThreshold = 50,
    children
  } = props;
  const [viewport, setViewport] = reactExports.useState(null);
  const [toastCount, setToastCount] = reactExports.useState(0);
  const isFocusedToastEscapeKeyDownRef = reactExports.useRef(false);
  const isClosePausedRef = reactExports.useRef(false);
  if (!label.trim()) {
    console.error(
      `Invalid prop \`label\` supplied to \`${PROVIDER_NAME}\`. Expected non-empty \`string\`.`
    );
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(Collection.Provider, { scope: __scopeToast, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
    ToastProviderProvider,
    {
      scope: __scopeToast,
      label,
      duration,
      swipeDirection,
      swipeThreshold,
      toastCount,
      viewport,
      onViewportChange: setViewport,
      onToastAdd: reactExports.useCallback(() => setToastCount((prevCount) => prevCount + 1), []),
      onToastRemove: reactExports.useCallback(() => setToastCount((prevCount) => prevCount - 1), []),
      isFocusedToastEscapeKeyDownRef,
      isClosePausedRef,
      children
    }
  ) });
};
ToastProvider$1.displayName = PROVIDER_NAME;
var VIEWPORT_NAME = "ToastViewport";
var VIEWPORT_DEFAULT_HOTKEY = ["F8"];
var VIEWPORT_PAUSE = "toast.viewportPause";
var VIEWPORT_RESUME = "toast.viewportResume";
var ToastViewport$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const {
      __scopeToast,
      hotkey = VIEWPORT_DEFAULT_HOTKEY,
      label = "Notifications ({hotkey})",
      ...viewportProps
    } = props;
    const context = useToastProviderContext(VIEWPORT_NAME, __scopeToast);
    const getItems = useCollection(__scopeToast);
    const wrapperRef = reactExports.useRef(null);
    const headFocusProxyRef = reactExports.useRef(null);
    const tailFocusProxyRef = reactExports.useRef(null);
    const ref = reactExports.useRef(null);
    const composedRefs = useComposedRefs(forwardedRef, ref, context.onViewportChange);
    const hotkeyLabel = hotkey.join("+").replace(/Key/g, "").replace(/Digit/g, "");
    const hasToasts = context.toastCount > 0;
    reactExports.useEffect(() => {
      const handleKeyDown = (event) => {
        const isHotkeyPressed = hotkey.length !== 0 && hotkey.every((key) => event[key] || event.code === key);
        if (isHotkeyPressed) ref.current?.focus();
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [hotkey]);
    reactExports.useEffect(() => {
      const wrapper = wrapperRef.current;
      const viewport = ref.current;
      if (hasToasts && wrapper && viewport) {
        const handlePause = () => {
          if (!context.isClosePausedRef.current) {
            const pauseEvent = new CustomEvent(VIEWPORT_PAUSE);
            viewport.dispatchEvent(pauseEvent);
            context.isClosePausedRef.current = true;
          }
        };
        const handleResume = () => {
          if (context.isClosePausedRef.current) {
            const resumeEvent = new CustomEvent(VIEWPORT_RESUME);
            viewport.dispatchEvent(resumeEvent);
            context.isClosePausedRef.current = false;
          }
        };
        const handleFocusOutResume = (event) => {
          const isFocusMovingOutside = !wrapper.contains(event.relatedTarget);
          if (isFocusMovingOutside) handleResume();
        };
        const handlePointerLeaveResume = () => {
          const isFocusInside = wrapper.contains(document.activeElement);
          if (!isFocusInside) handleResume();
        };
        wrapper.addEventListener("focusin", handlePause);
        wrapper.addEventListener("focusout", handleFocusOutResume);
        wrapper.addEventListener("pointermove", handlePause);
        wrapper.addEventListener("pointerleave", handlePointerLeaveResume);
        window.addEventListener("blur", handlePause);
        window.addEventListener("focus", handleResume);
        return () => {
          wrapper.removeEventListener("focusin", handlePause);
          wrapper.removeEventListener("focusout", handleFocusOutResume);
          wrapper.removeEventListener("pointermove", handlePause);
          wrapper.removeEventListener("pointerleave", handlePointerLeaveResume);
          window.removeEventListener("blur", handlePause);
          window.removeEventListener("focus", handleResume);
        };
      }
    }, [hasToasts, context.isClosePausedRef]);
    const getSortedTabbableCandidates = reactExports.useCallback(
      ({ tabbingDirection }) => {
        const toastItems = getItems();
        const tabbableCandidates = toastItems.map((toastItem) => {
          const toastNode = toastItem.ref.current;
          const toastTabbableCandidates = [toastNode, ...getTabbableCandidates(toastNode)];
          return tabbingDirection === "forwards" ? toastTabbableCandidates : toastTabbableCandidates.reverse();
        });
        return (tabbingDirection === "forwards" ? tabbableCandidates.reverse() : tabbableCandidates).flat();
      },
      [getItems]
    );
    reactExports.useEffect(() => {
      const viewport = ref.current;
      if (viewport) {
        const handleKeyDown = (event) => {
          const isMetaKey = event.altKey || event.ctrlKey || event.metaKey;
          const isTabKey = event.key === "Tab" && !isMetaKey;
          if (isTabKey) {
            const focusedElement = document.activeElement;
            const isTabbingBackwards = event.shiftKey;
            const targetIsViewport = event.target === viewport;
            if (targetIsViewport && isTabbingBackwards) {
              headFocusProxyRef.current?.focus();
              return;
            }
            const tabbingDirection = isTabbingBackwards ? "backwards" : "forwards";
            const sortedCandidates = getSortedTabbableCandidates({ tabbingDirection });
            const index = sortedCandidates.findIndex((candidate) => candidate === focusedElement);
            if (focusFirst(sortedCandidates.slice(index + 1))) {
              event.preventDefault();
            } else {
              isTabbingBackwards ? headFocusProxyRef.current?.focus() : tailFocusProxyRef.current?.focus();
            }
          }
        };
        viewport.addEventListener("keydown", handleKeyDown);
        return () => viewport.removeEventListener("keydown", handleKeyDown);
      }
    }, [getItems, getSortedTabbableCandidates]);
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(
      Branch,
      {
        ref: wrapperRef,
        role: "region",
        "aria-label": label.replace("{hotkey}", hotkeyLabel),
        tabIndex: -1,
        style: { pointerEvents: hasToasts ? void 0 : "none" },
        children: [
          hasToasts && /* @__PURE__ */ jsxRuntimeExports.jsx(
            FocusProxy,
            {
              ref: headFocusProxyRef,
              onFocusFromOutsideViewport: () => {
                const tabbableCandidates = getSortedTabbableCandidates({
                  tabbingDirection: "forwards"
                });
                focusFirst(tabbableCandidates);
              }
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Collection.Slot, { scope: __scopeToast, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.ol, { tabIndex: -1, ...viewportProps, ref: composedRefs }) }),
          hasToasts && /* @__PURE__ */ jsxRuntimeExports.jsx(
            FocusProxy,
            {
              ref: tailFocusProxyRef,
              onFocusFromOutsideViewport: () => {
                const tabbableCandidates = getSortedTabbableCandidates({
                  tabbingDirection: "backwards"
                });
                focusFirst(tabbableCandidates);
              }
            }
          )
        ]
      }
    );
  }
);
ToastViewport$1.displayName = VIEWPORT_NAME;
var FOCUS_PROXY_NAME = "ToastFocusProxy";
var FocusProxy = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeToast, onFocusFromOutsideViewport, ...proxyProps } = props;
    const context = useToastProviderContext(FOCUS_PROXY_NAME, __scopeToast);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      VisuallyHidden,
      {
        tabIndex: 0,
        ...proxyProps,
        ref: forwardedRef,
        style: { position: "fixed" },
        onFocus: (event) => {
          const prevFocusedElement = event.relatedTarget;
          const isFocusFromOutsideViewport = !context.viewport?.contains(prevFocusedElement);
          if (isFocusFromOutsideViewport) onFocusFromOutsideViewport();
        }
      }
    );
  }
);
FocusProxy.displayName = FOCUS_PROXY_NAME;
var TOAST_NAME = "Toast";
var TOAST_SWIPE_START = "toast.swipeStart";
var TOAST_SWIPE_MOVE = "toast.swipeMove";
var TOAST_SWIPE_CANCEL = "toast.swipeCancel";
var TOAST_SWIPE_END = "toast.swipeEnd";
var Toast$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { forceMount, open: openProp, defaultOpen, onOpenChange, ...toastProps } = props;
    const [open, setOpen] = useControllableState({
      prop: openProp,
      defaultProp: defaultOpen ?? true,
      onChange: onOpenChange,
      caller: TOAST_NAME
    });
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Presence, { present: forceMount || open, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
      ToastImpl,
      {
        open,
        ...toastProps,
        ref: forwardedRef,
        onClose: () => setOpen(false),
        onPause: useCallbackRef$1(props.onPause),
        onResume: useCallbackRef$1(props.onResume),
        onSwipeStart: composeEventHandlers(props.onSwipeStart, (event) => {
          event.currentTarget.setAttribute("data-swipe", "start");
        }),
        onSwipeMove: composeEventHandlers(props.onSwipeMove, (event) => {
          const { x: x2, y: y2 } = event.detail.delta;
          event.currentTarget.setAttribute("data-swipe", "move");
          event.currentTarget.style.setProperty("--radix-toast-swipe-move-x", `${x2}px`);
          event.currentTarget.style.setProperty("--radix-toast-swipe-move-y", `${y2}px`);
        }),
        onSwipeCancel: composeEventHandlers(props.onSwipeCancel, (event) => {
          event.currentTarget.setAttribute("data-swipe", "cancel");
          event.currentTarget.style.removeProperty("--radix-toast-swipe-move-x");
          event.currentTarget.style.removeProperty("--radix-toast-swipe-move-y");
          event.currentTarget.style.removeProperty("--radix-toast-swipe-end-x");
          event.currentTarget.style.removeProperty("--radix-toast-swipe-end-y");
        }),
        onSwipeEnd: composeEventHandlers(props.onSwipeEnd, (event) => {
          const { x: x2, y: y2 } = event.detail.delta;
          event.currentTarget.setAttribute("data-swipe", "end");
          event.currentTarget.style.removeProperty("--radix-toast-swipe-move-x");
          event.currentTarget.style.removeProperty("--radix-toast-swipe-move-y");
          event.currentTarget.style.setProperty("--radix-toast-swipe-end-x", `${x2}px`);
          event.currentTarget.style.setProperty("--radix-toast-swipe-end-y", `${y2}px`);
          setOpen(false);
        })
      }
    ) });
  }
);
Toast$1.displayName = TOAST_NAME;
var [ToastInteractiveProvider, useToastInteractiveContext] = createToastContext(TOAST_NAME, {
  onClose() {
  }
});
var ToastImpl = reactExports.forwardRef(
  (props, forwardedRef) => {
    const {
      __scopeToast,
      type = "foreground",
      duration: durationProp,
      open,
      onClose,
      onEscapeKeyDown,
      onPause,
      onResume,
      onSwipeStart,
      onSwipeMove,
      onSwipeCancel,
      onSwipeEnd,
      ...toastProps
    } = props;
    const context = useToastProviderContext(TOAST_NAME, __scopeToast);
    const [node, setNode] = reactExports.useState(null);
    const composedRefs = useComposedRefs(forwardedRef, (node2) => setNode(node2));
    const pointerStartRef = reactExports.useRef(null);
    const swipeDeltaRef = reactExports.useRef(null);
    const duration = durationProp || context.duration;
    const closeTimerStartTimeRef = reactExports.useRef(0);
    const closeTimerRemainingTimeRef = reactExports.useRef(duration);
    const closeTimerRef = reactExports.useRef(0);
    const { onToastAdd, onToastRemove } = context;
    const handleClose = useCallbackRef$1(() => {
      const isFocusInToast = node?.contains(document.activeElement);
      if (isFocusInToast) context.viewport?.focus();
      onClose();
    });
    const startTimer = reactExports.useCallback(
      (duration2) => {
        if (!duration2 || duration2 === Infinity) return;
        window.clearTimeout(closeTimerRef.current);
        closeTimerStartTimeRef.current = (/* @__PURE__ */ new Date()).getTime();
        closeTimerRef.current = window.setTimeout(handleClose, duration2);
      },
      [handleClose]
    );
    reactExports.useEffect(() => {
      const viewport = context.viewport;
      if (viewport) {
        const handleResume = () => {
          startTimer(closeTimerRemainingTimeRef.current);
          onResume?.();
        };
        const handlePause = () => {
          const elapsedTime = (/* @__PURE__ */ new Date()).getTime() - closeTimerStartTimeRef.current;
          closeTimerRemainingTimeRef.current = closeTimerRemainingTimeRef.current - elapsedTime;
          window.clearTimeout(closeTimerRef.current);
          onPause?.();
        };
        viewport.addEventListener(VIEWPORT_PAUSE, handlePause);
        viewport.addEventListener(VIEWPORT_RESUME, handleResume);
        return () => {
          viewport.removeEventListener(VIEWPORT_PAUSE, handlePause);
          viewport.removeEventListener(VIEWPORT_RESUME, handleResume);
        };
      }
    }, [context.viewport, duration, onPause, onResume, startTimer]);
    reactExports.useEffect(() => {
      if (open && !context.isClosePausedRef.current) startTimer(duration);
    }, [open, duration, context.isClosePausedRef, startTimer]);
    reactExports.useEffect(() => {
      onToastAdd();
      return () => onToastRemove();
    }, [onToastAdd, onToastRemove]);
    const announceTextContent = reactExports.useMemo(() => {
      return node ? getAnnounceTextContent(node) : null;
    }, [node]);
    if (!context.viewport) return null;
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      announceTextContent && /* @__PURE__ */ jsxRuntimeExports.jsx(
        ToastAnnounce,
        {
          __scopeToast,
          role: "status",
          "aria-live": type === "foreground" ? "assertive" : "polite",
          children: announceTextContent
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(ToastInteractiveProvider, { scope: __scopeToast, onClose: handleClose, children: reactDomExports.createPortal(
        /* @__PURE__ */ jsxRuntimeExports.jsx(Collection.ItemSlot, { scope: __scopeToast, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
          Root$2,
          {
            asChild: true,
            onEscapeKeyDown: composeEventHandlers(onEscapeKeyDown, () => {
              if (!context.isFocusedToastEscapeKeyDownRef.current) handleClose();
              context.isFocusedToastEscapeKeyDownRef.current = false;
            }),
            children: /* @__PURE__ */ jsxRuntimeExports.jsx(
              Primitive.li,
              {
                tabIndex: 0,
                "data-state": open ? "open" : "closed",
                "data-swipe-direction": context.swipeDirection,
                ...toastProps,
                ref: composedRefs,
                style: { userSelect: "none", touchAction: "none", ...props.style },
                onKeyDown: composeEventHandlers(props.onKeyDown, (event) => {
                  if (event.key !== "Escape") return;
                  onEscapeKeyDown?.(event.nativeEvent);
                  if (!event.nativeEvent.defaultPrevented) {
                    context.isFocusedToastEscapeKeyDownRef.current = true;
                    handleClose();
                  }
                }),
                onPointerDown: composeEventHandlers(props.onPointerDown, (event) => {
                  if (event.button !== 0) return;
                  pointerStartRef.current = { x: event.clientX, y: event.clientY };
                }),
                onPointerMove: composeEventHandlers(props.onPointerMove, (event) => {
                  if (!pointerStartRef.current) return;
                  const x2 = event.clientX - pointerStartRef.current.x;
                  const y2 = event.clientY - pointerStartRef.current.y;
                  const hasSwipeMoveStarted = Boolean(swipeDeltaRef.current);
                  const isHorizontalSwipe = ["left", "right"].includes(context.swipeDirection);
                  const clamp = ["left", "up"].includes(context.swipeDirection) ? Math.min : Math.max;
                  const clampedX = isHorizontalSwipe ? clamp(0, x2) : 0;
                  const clampedY = !isHorizontalSwipe ? clamp(0, y2) : 0;
                  const moveStartBuffer = event.pointerType === "touch" ? 10 : 2;
                  const delta = { x: clampedX, y: clampedY };
                  const eventDetail = { originalEvent: event, delta };
                  if (hasSwipeMoveStarted) {
                    swipeDeltaRef.current = delta;
                    handleAndDispatchCustomEvent(TOAST_SWIPE_MOVE, onSwipeMove, eventDetail, {
                      discrete: false
                    });
                  } else if (isDeltaInDirection(delta, context.swipeDirection, moveStartBuffer)) {
                    swipeDeltaRef.current = delta;
                    handleAndDispatchCustomEvent(TOAST_SWIPE_START, onSwipeStart, eventDetail, {
                      discrete: false
                    });
                    event.target.setPointerCapture(event.pointerId);
                  } else if (Math.abs(x2) > moveStartBuffer || Math.abs(y2) > moveStartBuffer) {
                    pointerStartRef.current = null;
                  }
                }),
                onPointerUp: composeEventHandlers(props.onPointerUp, (event) => {
                  const delta = swipeDeltaRef.current;
                  const target = event.target;
                  if (target.hasPointerCapture(event.pointerId)) {
                    target.releasePointerCapture(event.pointerId);
                  }
                  swipeDeltaRef.current = null;
                  pointerStartRef.current = null;
                  if (delta) {
                    const toast2 = event.currentTarget;
                    const eventDetail = { originalEvent: event, delta };
                    if (isDeltaInDirection(delta, context.swipeDirection, context.swipeThreshold)) {
                      handleAndDispatchCustomEvent(TOAST_SWIPE_END, onSwipeEnd, eventDetail, {
                        discrete: true
                      });
                    } else {
                      handleAndDispatchCustomEvent(
                        TOAST_SWIPE_CANCEL,
                        onSwipeCancel,
                        eventDetail,
                        {
                          discrete: true
                        }
                      );
                    }
                    toast2.addEventListener("click", (event2) => event2.preventDefault(), {
                      once: true
                    });
                  }
                })
              }
            )
          }
        ) }),
        context.viewport
      ) })
    ] });
  }
);
var ToastAnnounce = (props) => {
  const { __scopeToast, children, ...announceProps } = props;
  const context = useToastProviderContext(TOAST_NAME, __scopeToast);
  const [renderAnnounceText, setRenderAnnounceText] = reactExports.useState(false);
  const [isAnnounced, setIsAnnounced] = reactExports.useState(false);
  useNextFrame(() => setRenderAnnounceText(true));
  reactExports.useEffect(() => {
    const timer = window.setTimeout(() => setIsAnnounced(true), 1e3);
    return () => window.clearTimeout(timer);
  }, []);
  return isAnnounced ? null : /* @__PURE__ */ jsxRuntimeExports.jsx(Portal$1, { asChild: true, children: /* @__PURE__ */ jsxRuntimeExports.jsx(VisuallyHidden, { ...announceProps, children: renderAnnounceText && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    context.label,
    " ",
    children
  ] }) }) });
};
var TITLE_NAME = "ToastTitle";
var ToastTitle$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeToast, ...titleProps } = props;
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.div, { ...titleProps, ref: forwardedRef });
  }
);
ToastTitle$1.displayName = TITLE_NAME;
var DESCRIPTION_NAME = "ToastDescription";
var ToastDescription$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeToast, ...descriptionProps } = props;
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Primitive.div, { ...descriptionProps, ref: forwardedRef });
  }
);
ToastDescription$1.displayName = DESCRIPTION_NAME;
var ACTION_NAME = "ToastAction";
var ToastAction$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { altText, ...actionProps } = props;
    if (!altText.trim()) {
      console.error(
        `Invalid prop \`altText\` supplied to \`${ACTION_NAME}\`. Expected non-empty \`string\`.`
      );
      return null;
    }
    return /* @__PURE__ */ jsxRuntimeExports.jsx(ToastAnnounceExclude, { altText, asChild: true, children: /* @__PURE__ */ jsxRuntimeExports.jsx(ToastClose$1, { ...actionProps, ref: forwardedRef }) });
  }
);
ToastAction$1.displayName = ACTION_NAME;
var CLOSE_NAME = "ToastClose";
var ToastClose$1 = reactExports.forwardRef(
  (props, forwardedRef) => {
    const { __scopeToast, ...closeProps } = props;
    const interactiveContext = useToastInteractiveContext(CLOSE_NAME, __scopeToast);
    return /* @__PURE__ */ jsxRuntimeExports.jsx(ToastAnnounceExclude, { asChild: true, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
      Primitive.button,
      {
        type: "button",
        ...closeProps,
        ref: forwardedRef,
        onClick: composeEventHandlers(props.onClick, interactiveContext.onClose)
      }
    ) });
  }
);
ToastClose$1.displayName = CLOSE_NAME;
var ToastAnnounceExclude = reactExports.forwardRef((props, forwardedRef) => {
  const { __scopeToast, altText, ...announceExcludeProps } = props;
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    Primitive.div,
    {
      "data-radix-toast-announce-exclude": "",
      "data-radix-toast-announce-alt": altText || void 0,
      ...announceExcludeProps,
      ref: forwardedRef
    }
  );
});
function getAnnounceTextContent(container) {
  const textContent = [];
  const childNodes = Array.from(container.childNodes);
  childNodes.forEach((node) => {
    if (node.nodeType === node.TEXT_NODE && node.textContent) textContent.push(node.textContent);
    if (isHTMLElement(node)) {
      const isHidden2 = node.ariaHidden || node.hidden || node.style.display === "none";
      const isExcluded = node.dataset.radixToastAnnounceExclude === "";
      if (!isHidden2) {
        if (isExcluded) {
          const altText = node.dataset.radixToastAnnounceAlt;
          if (altText) textContent.push(altText);
        } else {
          textContent.push(...getAnnounceTextContent(node));
        }
      }
    }
  });
  return textContent;
}
function handleAndDispatchCustomEvent(name, handler, detail, { discrete }) {
  const currentTarget = detail.originalEvent.currentTarget;
  const event = new CustomEvent(name, { bubbles: true, cancelable: true, detail });
  if (handler) currentTarget.addEventListener(name, handler, { once: true });
  if (discrete) {
    dispatchDiscreteCustomEvent(currentTarget, event);
  } else {
    currentTarget.dispatchEvent(event);
  }
}
var isDeltaInDirection = (delta, direction, threshold = 0) => {
  const deltaX = Math.abs(delta.x);
  const deltaY = Math.abs(delta.y);
  const isDeltaX = deltaX > deltaY;
  if (direction === "left" || direction === "right") {
    return isDeltaX && deltaX > threshold;
  } else {
    return !isDeltaX && deltaY > threshold;
  }
};
function useNextFrame(callback = () => {
}) {
  const fn = useCallbackRef$1(callback);
  useLayoutEffect2(() => {
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => raf2 = window.requestAnimationFrame(fn));
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [fn]);
}
function isHTMLElement(node) {
  return node.nodeType === node.ELEMENT_NODE;
}
function getTabbableCandidates(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const isHiddenInput = node.tagName === "INPUT" && node.type === "hidden";
      if (node.disabled || node.hidden || isHiddenInput) return NodeFilter.FILTER_SKIP;
      return node.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}
function focusFirst(candidates) {
  const previouslyFocusedElement = document.activeElement;
  return candidates.some((candidate) => {
    if (candidate === previouslyFocusedElement) return true;
    candidate.focus();
    return document.activeElement !== previouslyFocusedElement;
  });
}
var Provider = ToastProvider$1;
var Viewport = ToastViewport$1;
var Root2 = Toast$1;
var Title = ToastTitle$1;
var Description = ToastDescription$1;
var Action = ToastAction$1;
var Close = ToastClose$1;
const ToastProvider = Provider;
const ToastViewport = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Viewport,
  {
    ref,
    className: cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    ),
    ...props
  }
));
ToastViewport.displayName = Viewport.displayName;
const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive: "destructive group border-destructive bg-destructive text-destructive-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
const Toast = reactExports.forwardRef(({ className, variant, ...props }, ref) => {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    Root2,
    {
      ref,
      className: cn(toastVariants({ variant }), className),
      ...props
    }
  );
});
Toast.displayName = Root2.displayName;
const ToastAction = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Action,
  {
    ref,
    className: cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className
    ),
    ...props
  }
));
ToastAction.displayName = Action.displayName;
const ToastClose = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Close,
  {
    ref,
    className: cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-[var(--text-on-accent)] group-[.destructive]:hover:text-[var(--text-on-accent)] group-[.destructive]:focus:ring-[var(--text-on-accent)] group-[.destructive]:focus:ring-offset-[var(--destructive)]",
      className
    ),
    "toast-close": "",
    ...props,
    children: /* @__PURE__ */ jsxRuntimeExports.jsx(X, { className: "h-4 w-4" })
  }
));
ToastClose.displayName = Close.displayName;
const ToastTitle = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Title,
  {
    ref,
    className: cn("text-sm font-semibold", className),
    ...props
  }
));
ToastTitle.displayName = Title.displayName;
const ToastDescription = reactExports.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  Description,
  {
    ref,
    className: cn("text-sm opacity-90", className),
    ...props
  }
));
ToastDescription.displayName = Description.displayName;
function Toaster() {
  const { toasts } = useToast();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(ToastProvider, { children: [
    toasts.map(function({ id: id2, title, description, action, ...props }) {
      return /* @__PURE__ */ jsxRuntimeExports.jsxs(Toast, { ...props, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-1", children: [
          title && /* @__PURE__ */ jsxRuntimeExports.jsx(ToastTitle, { children: title }),
          description && /* @__PURE__ */ jsxRuntimeExports.jsx(ToastDescription, { children: description })
        ] }),
        action,
        /* @__PURE__ */ jsxRuntimeExports.jsx(ToastClose, {})
      ] }, id2);
    }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(ToastViewport, {})
  ] });
}
function Skeleton({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      className: cn("animate-pulse rounded-md bg-muted", className),
      ...props
    }
  );
}
const Dashboard = reactExports.lazy(() => __vitePreload(() => import("./Dashboard-DzOGGc2C.js"), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12]) : void 0, import.meta.url).then((m2) => ({ default: m2.Dashboard })));
const Providers = reactExports.lazy(() => __vitePreload(() => import("./Providers-BBqbedF7.js"), true ? __vite__mapDeps([13,1,14,15,16,17,12,10,18,6,19,20,21,22,23,24,25,26,2,27,28,29,30,8,9]) : void 0, import.meta.url).then((m2) => ({ default: m2.Providers })));
const Aggregate = reactExports.lazy(() => __vitePreload(() => import("./Aggregate-CU247JL8.js"), true ? __vite__mapDeps([31,8,9,32,19,21,33,14,15,34,1,25,35,6,28,5,17,10]) : void 0, import.meta.url).then((m2) => ({ default: m2.Aggregate })));
const Channels = reactExports.lazy(() => __vitePreload(() => import("./Channels-BKn7nhJI.js"), true ? __vite__mapDeps([36,37,32,19,21,33,14,15,1,10,24,6]) : void 0, import.meta.url).then((m2) => ({ default: m2.Channels })));
const ProxySettings = reactExports.lazy(() => __vitePreload(() => import("./ProxySettings-DWGoJfSX.js"), true ? __vite__mapDeps([38,16,15,1,14,19,39,4,23,35,10,33,21,3,22,6,40,29,2,27,28,7,24,8,9]) : void 0, import.meta.url).then((m2) => ({ default: m2.ProxySettings })));
const Models = reactExports.lazy(() => __vitePreload(() => import("./Models-zPHr6guu.js"), true ? __vite__mapDeps([41,16,15,1,14,19,29,39,4,37,34,17,21,22,9,7,27,33,10,20,6]) : void 0, import.meta.url).then((m2) => ({ default: m2.Models })));
const Gateways = reactExports.lazy(() => __vitePreload(() => import("./Gateways-lZ9U73xs.js"), true ? __vite__mapDeps([42,1,8,9,10,6,21]) : void 0, import.meta.url).then((m2) => ({ default: m2.Gateways })));
const Logs = reactExports.lazy(() => __vitePreload(() => import("./Logs-DmHG7Sr8.js"), true ? __vite__mapDeps([43,1,19,15,16,18,26,23,2,44,11,27]) : void 0, import.meta.url));
const Settings = reactExports.lazy(() => __vitePreload(() => import("./Settings-Cz0rtoCJ.js"), true ? __vite__mapDeps([45,16,15,1,14,18,22,7,30,40,24,10,44,21,23,8,9]) : void 0, import.meta.url).then((m2) => ({ default: m2.Settings })));
function PageLoader() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center justify-center min-h-[400px]", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4 w-full max-w-md", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Skeleton, { className: "h-8 w-3/4" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Skeleton, { className: "h-4 w-full" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Skeleton, { className: "h-4 w-5/6" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Skeleton, { className: "h-32 w-full" })
  ] }) });
}
function ShellNavigation() {
  const navigate = useNavigate();
  reactExports.useEffect(() => {
    const bridge = window.modelportShell;
    const off = bridge?.onNavigate?.((path2) => {
      if (typeof path2 === "string" && path2.startsWith("/") && !path2.startsWith("//")) navigate(path2);
    });
    return () => off?.();
  }, [navigate]);
  return null;
}
function App() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Routes, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/tray", element: /* @__PURE__ */ jsxRuntimeExports.jsx(ErrorBoundary, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(TrayView, {}) }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Route, { element: /* @__PURE__ */ jsxRuntimeExports.jsx(MainLayout, {}), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Dashboard, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/providers", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Providers, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/aggregate", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Aggregate, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/channels", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Channels, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/proxy", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(ProxySettings, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/models", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Models, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/gateways", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Gateways, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/logs", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Logs, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/settings", element: /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Suspense, { fallback: /* @__PURE__ */ jsxRuntimeExports.jsx(PageLoader, {}), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Settings, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "*", element: /* @__PURE__ */ jsxRuntimeExports.jsx(Navigate, { to: "/", replace: true }) })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(ShellNavigation, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Toaster, {})
  ] });
}
const IpcChannels = {
  PROXY_START: "proxy:start",
  PROXY_STOP: "proxy:stop",
  PROXY_GET_STATUS: "proxy:getStatus",
  PROXY_STATUS_CHANGED: "proxy:statusChanged",
  PROXY_GET_STATISTICS: "proxy:getStatistics",
  // Extra TLS listener (Claude Desktop's gateway refuses plain HTTP). Status is
  // read-only; installing the generated certificate into the OS trust store is
  // always a user click, never a silent startup action. `uninstall-trust` is the
  // inverse and is equally click-only - it removes the cert, not the file.
  TLS_STATUS: "tls:status",
  TLS_INSTALL_TRUST: "tls:install-trust",
  TLS_UNINSTALL_TRUST: "tls:uninstall-trust",
  CONFIG_GET: "config:get",
  CONFIG_UPDATE: "config:update",
  CONFIG_CHANGED: "config:changed",
  // 多路由 CRUD（R2）。返回 `{ok:true,…} | {ok:false,error:{code,message}}`，
  // 与 channels:* 系列同风格：错误必须原样到达 UI，不许在 IPC 层变成 undefined。
  // `config:update` 依旧能整表写 routes，但那条通道不做名字校验。
  ROUTES_LIST: "routes:list",
  ROUTES_CREATE: "routes:create",
  ROUTES_UPDATE: "routes:update",
  ROUTES_DELETE: "routes:delete",
  // 候选池预览：按路由配置跑一遍采集/策略/手动增删，返回逐模型状态与筛除原因。
  // 只读，不写任何状态（不扣冷却、不请求上游）。
  ROUTES_PREVIEW: "routes:preview",
  // 逐路由的候选模型数（一次采集折全表，比逐条 preview 便宜一个量级）。只读。
  ROUTES_POOL_SIZES: "routes:pool-sizes",
  // Anthropic 客户端（Claude Desktop / Claude Code）的可发现名：一条只读预览、一条落库。
  // 分两条是因为客户端那一侧的白名单会筛名字，用户必须先看一眼「会新增哪几条」再写。
  ANTHROPIC_DISCOVERY_PLAN: "anthropic:discovery-plan",
  ANTHROPIC_DISCOVERY_APPLY: "anthropic:discovery-apply",
  STORE_GET: "store:get",
  STORE_CLEAR_ALL: "store:clearAll",
  STORE_INIT_ERROR: "store:initError",
  STORE_RETRY_INIT: "store:retryInit",
  // 完整备份（全部数据与配置）。与 `providers:export`（单个自定义供应商）以及渲染层
  // localStorage 的「界面偏好导出」是三件事：这条通道搬的是 providers / accounts（含
  // 解密后的凭据）/ config / 路由 / 模型标注 / 渠道登录态。
  // `backup:pick` 把文件读进主进程并返回一次性 token，`backup:apply` 只认 token ——
  // 渲染层没有构造一份「备份」直接改账号表的能力。
  BACKUP_EXPORT: "backup:export",
  BACKUP_PICK: "backup:pick",
  BACKUP_UNLOCK: "backup:unlock",
  BACKUP_APPLY: "backup:apply",
  BACKUP_CANCEL: "backup:cancel",
  BACKUP_RESTART: "backup:restart",
  PROVIDERS_GET_ALL: "providers:getAll",
  PROVIDERS_GET_BUILTIN: "providers:getBuiltin",
  PROVIDERS_ADD: "providers:add",
  PROVIDERS_UPDATE: "providers:update",
  PROVIDERS_DELETE: "providers:delete",
  PROVIDERS_CHECK_STATUS: "providers:checkStatus",
  PROVIDERS_CHECK_ALL_STATUS: "providers:checkAllStatus",
  PROVIDERS_DUPLICATE: "providers:duplicate",
  PROVIDERS_EXPORT: "providers:export",
  PROVIDERS_IMPORT: "providers:import",
  PROVIDERS_UPDATE_MODELS: "providers:updateModels",
  PROVIDERS_GET_EFFECTIVE_MODELS: "providers:getEffectiveModels",
  PROVIDERS_GET_MODEL_CATALOGUE: "providers:getModelCatalogue",
  PROVIDERS_SET_MODELS_SERVED: "providers:setModelsServed",
  PROVIDERS_ADD_CUSTOM_MODEL: "providers:addCustomModel",
  PROVIDERS_REMOVE_MODEL: "providers:removeModel",
  PROVIDERS_RESET_MODELS: "providers:resetModels",
  // 手工能力标注（vision/tools/reasoning/context/...），优先级高于所有自动标注
  PROVIDERS_GET_MODEL_MARKS: "providers:getModelMarks",
  PROVIDERS_SET_MODEL_MARK: "providers:setModelMark",
  // 元数据解析报表（覆盖率 + 待标注队列）与手动探测（打开页面不发起请求）
  PROVIDERS_GET_MODEL_METADATA: "providers:getModelMetadata",
  /** 单个模型的解析结果：逐模型标注入口用它，避免为一次点击重算整张报表。 */
  PROVIDERS_GET_MODEL_METADATA_ONE: "providers:getModelMetadataOne",
  PROVIDERS_PROBE_MODEL: "providers:probeModel",
  PROVIDERS_CANCEL_PROBE: "providers:cancelProbe",
  PROVIDERS_GET_PROBE_JOBS: "providers:getProbeJobs",
  /** 主进程 → 界面的进度事件（单向推送，不是 invoke）。 */
  PROVIDERS_PROBE_PROGRESS: "providers:probeProgress",
  // 标准模型库：读取快照只读磁盘；刷新必须由用户显式触发（无定时、无开页自动抓取）
  PROVIDERS_GET_CATALOG_STATUSES: "providers:getCatalogStatuses",
  PROVIDERS_REFRESH_CATALOG: "providers:refreshCatalog",
  PROVIDERS_GET_CATALOG_CANDIDATES: "providers:getCatalogCandidates",
  PROVIDERS_ADOPT_CATALOG_FIELD: "providers:adoptCatalogField",
  PROVIDERS_REVOKE_CATALOG_ADOPTION: "providers:revokeCatalogAdoption",
  // 全部补齐：主进程持有任务，界面只订阅进度
  PROVIDERS_ESTIMATE_CATALOG_BATCH: "providers:estimateCatalogBatch",
  PROVIDERS_START_CATALOG_BATCH: "providers:startCatalogBatch",
  PROVIDERS_PAUSE_CATALOG_BATCH: "providers:pauseCatalogBatch",
  PROVIDERS_RESUME_CATALOG_BATCH: "providers:resumeCatalogBatch",
  PROVIDERS_CANCEL_CATALOG_BATCH: "providers:cancelCatalogBatch",
  PROVIDERS_GET_CATALOG_BATCH_JOBS: "providers:getCatalogBatchJobs",
  PROVIDERS_CATALOG_BATCH_PROGRESS: "providers:catalogBatchProgress",
  AGGREGATE_LIST: "aggregate:list",
  AGGREGATE_DETAIL: "aggregate:detail",
  AGGREGATE_SAVE: "aggregate:save",
  AGGREGATE_SET_ENABLED: "aggregate:setEnabled",
  AGGREGATE_REMOVE: "aggregate:remove",
  AGGREGATE_TEST: "aggregate:test",
  AGGREGATE_SYNC_MODELS: "aggregate:syncModels",
  AGGREGATE_ADD_KEY: "aggregate:addKey",
  AGGREGATE_REMOVE_KEY: "aggregate:removeKey",
  AGGREGATE_SET_KEY_ENABLED: "aggregate:setKeyEnabled",
  AGGREGATE_VALIDATE_KEY: "aggregate:validateKey",
  AGGREGATE_ADD_MODEL: "aggregate:addModel",
  AGGREGATE_REMOVE_MODEL: "aggregate:removeModel",
  AGGREGATE_SET_MODEL_ENABLED: "aggregate:setModelEnabled",
  AGGREGATE_SET_MODEL_PARAMS: "aggregate:setModelParams",
  AGGREGATE_TEST_MODEL: "aggregate:testModel",
  // 用户在详情页点一次才发一次：没有周期轮询，也没有开页自动查。
  AGGREGATE_QUERY_CREDITS: "aggregate:queryCredits",
  CHANNELS_LIST: "channels:list",
  CHANNELS_ACCOUNT_COUNTS: "channels:accountCounts",
  CHANNELS_RPC: "channels:rpc",
  CHANNELS_CREDITS: "channels:credits",
  CHANNELS_CREDITS_ALL: "channels:creditsAll",
  CHANNELS_SET_ENABLED: "channels:setEnabled",
  CHANNELS_REMOVE: "channels:remove",
  CHANNELS_AUTO_CHECKIN: "channels:autoCheckin",
  CHANNELS_MODELS: "channels:models",
  CHANNELS_REFRESH_MODELS: "channels:refreshModels",
  CHANNELS_SET_MODEL_DISABLED: "channels:setModelDisabled",
  CHANNELS_CLEAR_DEAD_MODELS: "channels:clearDeadModels",
  CHANNELS_CHANGED: "channels:changed",
  ACCOUNTS_GET_ALL: "accounts:getAll",
  ACCOUNTS_GET_BY_ID: "accounts:getById",
  ACCOUNTS_GET_BY_PROVIDER: "accounts:getByProvider",
  ACCOUNTS_ADD: "accounts:add",
  ACCOUNTS_UPDATE: "accounts:update",
  ACCOUNTS_DELETE: "accounts:delete",
  ACCOUNTS_VALIDATE: "accounts:validate",
  ACCOUNTS_VALIDATE_TOKEN: "accounts:validateToken",
  OAUTH_START_LOGIN: "oauth:startLogin",
  OAUTH_CANCEL_LOGIN: "oauth:cancelLogin",
  OAUTH_CALLBACK: "oauth:callback",
  OAUTH_LOGIN_WITH_TOKEN: "oauth:loginWithToken",
  OAUTH_VALIDATE_TOKEN: "oauth:validateToken",
  OAUTH_REFRESH_TOKEN: "oauth:refreshToken",
  OAUTH_GET_STATUS: "oauth:getStatus",
  OAUTH_PROGRESS: "oauth:progress",
  LOGS_GET: "logs:get",
  LOGS_GET_STATS: "logs:getStats",
  LOGS_GET_TREND: "logs:getTrend",
  LOGS_GET_ACCOUNT_TREND: "logs:getAccountTrend",
  LOGS_CLEAR: "logs:clear",
  LOGS_EXPORT: "logs:export",
  LOGS_GET_BY_ID: "logs:getById",
  REQUEST_LOGS_GET: "requestLogs:get",
  REQUEST_LOGS_GET_BY_ID: "requestLogs:getById",
  REQUEST_LOGS_GET_STATS: "requestLogs:getStats",
  REQUEST_LOGS_CLEAR: "requestLogs:clear",
  REQUEST_LOGS_BUNDLE: "requestLogs:bundle",
  REQUEST_LOGS_BUNDLE_SAVE: "requestLogs:bundleSave",
  /** Main -> renderer: one already-persisted row, so the log list need not poll. */
  REQUEST_LOGS_NEW: "requestLogs:new",
  STATISTICS_GET: "statistics:get",
  STATISTICS_GET_TODAY: "statistics:getToday",
  STATISTICS_GET_TOKEN_USAGE: "statistics:getTokenUsage",
  STATISTICS_GET_TOKEN_USAGE_HISTORY: "statistics:getTokenUsageHistory",
  STATISTICS_GET_TOKEN_USAGE_DAYS: "statistics:getTokenUsageDays",
  APP_GET_VERSION: "app:getVersion",
  APP_CHECK_UPDATE: "app:checkUpdate",
  APP_DOWNLOAD_UPDATE: "app:downloadUpdate",
  APP_INSTALL_UPDATE: "app:installUpdate",
  APP_UPDATE_CHECKING: "app:updateChecking",
  APP_UPDATE_AVAILABLE: "app:updateAvailable",
  APP_UPDATE_NOT_AVAILABLE: "app:updateNotAvailable",
  APP_UPDATE_PROGRESS: "app:updateProgress",
  APP_UPDATE_DOWNLOADED: "app:updateDownloaded",
  APP_UPDATE_ERROR: "app:updateError",
  APP_GET_UPDATE_STATUS: "app:getUpdateStatus",
  APP_MINIMIZE: "app:minimize",
  APP_MAXIMIZE: "app:maximize",
  APP_CLOSE: "app:close",
  APP_SHOW_WINDOW: "app:showWindow",
  APP_HIDE_WINDOW: "app:hideWindow",
  APP_SET_TITLE_BAR_THEME: "app:setTitleBarTheme",
  APP_OPEN_EXTERNAL: "app:openExternal",
  SESSION_GET_CONFIG: "session:getConfig",
  SESSION_UPDATE_CONFIG: "session:updateConfig",
  SESSION_GET_ALL: "session:getAll",
  SESSION_GET_ACTIVE: "session:getActive",
  SESSION_GET_BY_ID: "session:getById",
  SESSION_GET_BY_ACCOUNT: "session:getByAccount",
  SESSION_GET_BY_PROVIDER: "session:getByProvider",
  SESSION_DELETE: "session:delete",
  SESSION_CLEAR_ALL: "session:clearAll",
  SESSION_CLEAN_EXPIRED: "session:cleanExpired",
  MANAGEMENT_API_GET_CONFIG: "managementApi:getConfig",
  MANAGEMENT_API_UPDATE_CONFIG: "managementApi:updateConfig",
  MANAGEMENT_API_GENERATE_SECRET: "managementApi:generateSecret",
  CONTEXT_MANAGEMENT_GET_CONFIG: "contextManagement:getConfig",
  CONTEXT_MANAGEMENT_UPDATE_CONFIG: "contextManagement:updateConfig",
  // 供应商模型清单定时刷新：状态只读（lastRun/nextRun/开关），配置走 config:update，
  // 立即刷新一把走 triggerNow。与 AGGREGATE_QUERY_CREDITS 同款"手动触发才发一次"纪律。
  MODEL_REFRESH_GET_STATUS: "modelRefresh:getStatus",
  MODEL_REFRESH_TRIGGER_NOW: "modelRefresh:triggerNow"
};
function createElectronAPI(wire2) {
  const proxyAPI = {
    start: (port) => wire2.invoke(IpcChannels.PROXY_START, port),
    stop: () => wire2.invoke(IpcChannels.PROXY_STOP),
    getStatus: () => wire2.invoke(IpcChannels.PROXY_GET_STATUS),
    getStatistics: () => wire2.invoke(IpcChannels.PROXY_GET_STATISTICS),
    onStatusChanged: (callback) => {
      const handler = (_event, status) => callback(status);
      wire2.on(IpcChannels.PROXY_STATUS_CHANGED, handler);
      return () => wire2.off(IpcChannels.PROXY_STATUS_CHANGED, handler);
    }
  };
  const tlsAPI = {
    getStatus: () => wire2.invoke(IpcChannels.TLS_STATUS),
    installTrust: () => wire2.invoke(IpcChannels.TLS_INSTALL_TRUST),
    uninstallTrust: () => wire2.invoke(IpcChannels.TLS_UNINSTALL_TRUST)
  };
  const storeAPI = {
    get: (key) => wire2.invoke(IpcChannels.STORE_GET, key),
    // 没有 `set` / `delete`：整份配置走 `config:update`（主进程深合并），厂商/账号/路由
    // 各有专用通道。通用写通道曾让渲染层能绕过 `encryptCredentials` 把明文凭据写进
    // data.json，现在主进程对未登记键直接拒绝，这层也一并撤掉，不留「调用必失败」的面。
    clearAll: () => wire2.invoke(IpcChannels.STORE_CLEAR_ALL),
    onInitError: (callback) => {
      const handler = (_event, error) => callback(error);
      wire2.on(IpcChannels.STORE_INIT_ERROR, handler);
      return () => wire2.off(IpcChannels.STORE_INIT_ERROR, handler);
    },
    retryInit: () => wire2.invoke(IpcChannels.STORE_RETRY_INIT)
  };
  const backupAPI = {
    export: (options) => wire2.invoke(IpcChannels.BACKUP_EXPORT, options),
    pick: () => wire2.uploadBackup ? wire2.uploadBackup() : wire2.invoke(IpcChannels.BACKUP_PICK),
    unlock: (token, password) => wire2.invoke(IpcChannels.BACKUP_UNLOCK, token, password),
    apply: (token, mode) => wire2.invoke(IpcChannels.BACKUP_APPLY, token, mode),
    cancel: (token) => wire2.invoke(IpcChannels.BACKUP_CANCEL, token),
    restart: () => wire2.invoke(IpcChannels.BACKUP_RESTART)
  };
  const providersAPI = {
    getAll: () => wire2.invoke(IpcChannels.PROVIDERS_GET_ALL),
    getBuiltin: () => wire2.invoke(IpcChannels.PROVIDERS_GET_BUILTIN),
    add: (data) => wire2.invoke(IpcChannels.PROVIDERS_ADD, data),
    update: (id2, updates) => wire2.invoke(IpcChannels.PROVIDERS_UPDATE, id2, updates),
    delete: (id2) => wire2.invoke(IpcChannels.PROVIDERS_DELETE, id2),
    checkStatus: (providerId) => wire2.invoke(IpcChannels.PROVIDERS_CHECK_STATUS, providerId),
    checkAllStatus: () => wire2.invoke(IpcChannels.PROVIDERS_CHECK_ALL_STATUS),
    duplicate: (id2) => wire2.invoke(IpcChannels.PROVIDERS_DUPLICATE, id2),
    export: (id2) => wire2.invoke(IpcChannels.PROVIDERS_EXPORT, id2),
    import: (jsonData) => wire2.invoke(IpcChannels.PROVIDERS_IMPORT, jsonData),
    updateModels: (providerId) => wire2.invoke(IpcChannels.PROVIDERS_UPDATE_MODELS, providerId),
    getEffectiveModels: (providerId) => wire2.invoke(IpcChannels.PROVIDERS_GET_EFFECTIVE_MODELS, providerId),
    getModelCatalogue: (providerId) => wire2.invoke(IpcChannels.PROVIDERS_GET_MODEL_CATALOGUE, providerId),
    setModelsServed: (providerId, names, served) => wire2.invoke(IpcChannels.PROVIDERS_SET_MODELS_SERVED, providerId, names, served),
    addCustomModel: (providerId, model) => wire2.invoke(IpcChannels.PROVIDERS_ADD_CUSTOM_MODEL, providerId, model),
    removeModel: (providerId, modelName) => wire2.invoke(IpcChannels.PROVIDERS_REMOVE_MODEL, providerId, modelName),
    resetModels: (providerId) => wire2.invoke(IpcChannels.PROVIDERS_RESET_MODELS, providerId),
    getModelMarks: () => wire2.invoke(IpcChannels.PROVIDERS_GET_MODEL_MARKS),
    setModelMark: (providerId, displayName, mark) => wire2.invoke(IpcChannels.PROVIDERS_SET_MODEL_MARK, providerId, displayName, mark),
    getModelMetadata: () => wire2.invoke(IpcChannels.PROVIDERS_GET_MODEL_METADATA),
    /** 单个模型的元数据解析结果（逐模型标注入口用，不重算整张报表）。 */
    getModelMetadataOne: (providerId, displayName) => wire2.invoke(IpcChannels.PROVIDERS_GET_MODEL_METADATA_ONE, providerId, displayName),
    probeModel: (providerId, displayName, scope, force) => wire2.invoke(IpcChannels.PROVIDERS_PROBE_MODEL, providerId, displayName, scope, force),
    /** 取消一条进行中的探测：立即停止后续档位，已完成档位结论保留。 */
    cancelProbe: (jobId) => wire2.invoke(IpcChannels.PROVIDERS_CANCEL_PROBE, jobId),
    /** 关闭弹窗后回读后台任务：进行中 + 最近完成。 */
    getProbeJobs: () => wire2.invoke(IpcChannels.PROVIDERS_GET_PROBE_JOBS),
    /** 探测进度事件；返回取消订阅函数。 */
    onProbeProgress: (listener) => {
      const handler = (_event, payload) => listener(payload);
      wire2.on(IpcChannels.PROVIDERS_PROBE_PROGRESS, handler);
      return () => wire2.off(IpcChannels.PROVIDERS_PROBE_PROGRESS, handler);
    },
    /** 标准模型库：快照元数据（不联网、不含 entries） */
    getCatalogStatuses: () => wire2.invoke(IpcChannels.PROVIDERS_GET_CATALOG_STATUSES),
    /** 用户显式刷新；失败时返回 success:false 且旧快照保留 */
    refreshCatalog: (source) => wire2.invoke(IpcChannels.PROVIDERS_REFRESH_CATALOG, source),
    getCatalogCandidates: (providerId, displayName) => wire2.invoke(IpcChannels.PROVIDERS_GET_CATALOG_CANDIDATES, providerId, displayName),
    adoptCatalogField: (providerId, displayName, catalogId, field) => wire2.invoke(
      IpcChannels.PROVIDERS_ADOPT_CATALOG_FIELD,
      providerId,
      displayName,
      catalogId,
      field
    ),
    revokeCatalogAdoption: (providerId, displayName, field) => wire2.invoke(
      IpcChannels.PROVIDERS_REVOKE_CATALOG_ADOPTION,
      providerId,
      displayName,
      field
    ),
    /** 「全部补齐」预演：只读本地快照，不联网。 */
    /** 预演合计（只读本地快照，不联网）。`providerId` 给定时范围收到这一家。 */
    estimateCatalogBatch: (providerId) => wire2.invoke(IpcChannels.PROVIDERS_ESTIMATE_CATALOG_BATCH, providerId),
    /** 启动主进程批量任务；`probe` 是一次性开关，`retryFailedOf` 只重试失败项，`providerId` 收口范围。 */
    startCatalogBatch: (input) => wire2.invoke(IpcChannels.PROVIDERS_START_CATALOG_BATCH, input),
    pauseCatalogBatch: (jobId) => wire2.invoke(IpcChannels.PROVIDERS_PAUSE_CATALOG_BATCH, jobId),
    resumeCatalogBatch: (jobId) => wire2.invoke(IpcChannels.PROVIDERS_RESUME_CATALOG_BATCH, jobId),
    cancelCatalogBatch: (jobId) => wire2.invoke(IpcChannels.PROVIDERS_CANCEL_CATALOG_BATCH, jobId),
    getCatalogBatchJobs: () => wire2.invoke(IpcChannels.PROVIDERS_GET_CATALOG_BATCH_JOBS),
    onCatalogBatchProgress: (listener) => {
      const handler = (_event, payload) => listener(payload);
      wire2.on(IpcChannels.PROVIDERS_CATALOG_BATCH_PROGRESS, handler);
      return () => wire2.off(IpcChannels.PROVIDERS_CATALOG_BATCH_PROGRESS, handler);
    }
  };
  const accountsAPI = {
    // `getAll` 没有 `includeCredentials`：列表页拿不到凭据。`getById` 还留着，
    // 账号编辑框用它预填已存的 Key，去掉它会让界面在编辑时把凭据清空。
    getAll: () => wire2.invoke(IpcChannels.ACCOUNTS_GET_ALL),
    getById: (id2, includeCredentials) => wire2.invoke(IpcChannels.ACCOUNTS_GET_BY_ID, id2, includeCredentials),
    getByProvider: (providerId) => wire2.invoke(IpcChannels.ACCOUNTS_GET_BY_PROVIDER, providerId),
    add: (data) => wire2.invoke(IpcChannels.ACCOUNTS_ADD, data),
    update: (id2, updates) => wire2.invoke(IpcChannels.ACCOUNTS_UPDATE, id2, updates),
    delete: (id2) => wire2.invoke(IpcChannels.ACCOUNTS_DELETE, id2),
    validate: (accountId) => wire2.invoke(IpcChannels.ACCOUNTS_VALIDATE, accountId),
    validateToken: (providerId, credentials) => wire2.invoke(IpcChannels.ACCOUNTS_VALIDATE_TOKEN, providerId, credentials)
  };
  const oauthAPI = {
    startLogin: (providerId, providerType) => wire2.invoke(IpcChannels.OAUTH_START_LOGIN, providerId, providerType),
    cancelLogin: () => wire2.invoke(IpcChannels.OAUTH_CANCEL_LOGIN),
    loginWithToken: (providerId, providerType, token) => wire2.invoke(IpcChannels.OAUTH_LOGIN_WITH_TOKEN, { providerId, providerType, token }),
    validateToken: (providerId, providerType, credentials) => wire2.invoke(IpcChannels.OAUTH_VALIDATE_TOKEN, { providerId, providerType, credentials }),
    refreshToken: (providerId, providerType, credentials) => wire2.invoke(IpcChannels.OAUTH_REFRESH_TOKEN, { providerId, providerType, credentials }),
    getStatus: () => wire2.invoke(IpcChannels.OAUTH_GET_STATUS),
    onCallback: (callback) => {
      const handler = (_event, result) => callback(result);
      wire2.on(IpcChannels.OAUTH_CALLBACK, handler);
      return () => wire2.off(IpcChannels.OAUTH_CALLBACK, handler);
    },
    onProgress: (callback) => {
      const handler = (_event, event) => callback(event);
      wire2.on(IpcChannels.OAUTH_PROGRESS, handler);
      return () => wire2.off(IpcChannels.OAUTH_PROGRESS, handler);
    }
  };
  const logsAPI = {
    get: (filter) => wire2.invoke(IpcChannels.LOGS_GET, filter),
    getStats: () => wire2.invoke(IpcChannels.LOGS_GET_STATS),
    getTrend: (days) => wire2.invoke(IpcChannels.LOGS_GET_TREND, days),
    getAccountTrend: (accountId, days) => wire2.invoke(IpcChannels.LOGS_GET_ACCOUNT_TREND, accountId, days),
    clear: () => wire2.invoke(IpcChannels.LOGS_CLEAR),
    export: (format) => wire2.invoke(IpcChannels.LOGS_EXPORT, format),
    getById: (id2) => wire2.invoke(IpcChannels.LOGS_GET_BY_ID, id2)
  };
  const requestLogsAPI = {
    get: (filter) => wire2.invoke(IpcChannels.REQUEST_LOGS_GET, filter),
    getById: (id2) => wire2.invoke(IpcChannels.REQUEST_LOGS_GET_BY_ID, id2),
    getStats: () => wire2.invoke(IpcChannels.REQUEST_LOGS_GET_STATS),
    clear: () => wire2.invoke(IpcChannels.REQUEST_LOGS_CLEAR),
    bundle: (key) => wire2.invoke(IpcChannels.REQUEST_LOGS_BUNDLE, key),
    saveBundle: (key) => wire2.invoke(IpcChannels.REQUEST_LOGS_BUNDLE_SAVE, key),
    onNewLog: (callback) => {
      const handler = (_event, log) => callback(log);
      wire2.on(IpcChannels.REQUEST_LOGS_NEW, handler);
      return () => wire2.off(IpcChannels.REQUEST_LOGS_NEW, handler);
    }
  };
  const statisticsAPI = {
    get: () => wire2.invoke(IpcChannels.STATISTICS_GET),
    getToday: () => wire2.invoke(IpcChannels.STATISTICS_GET_TODAY),
    /**
     * Today's token counters, with the upstream-reported and `chars/4`-estimated
     * pools kept apart — see `shared/tokenAccounting`.
     */
    getTokenUsage: () => wire2.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE),
    /** The newest `days` local days of token counters, oldest first. */
    getTokenUsageHistory: (days) => wire2.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE_HISTORY, days),
    /**
     * Every retained day of token counters, keyed by local day, including the
     * per-provider split. Handed over whole because the period the card sums over
     * is the user's choice, made after this call.
     */
    getTokenUsageDays: () => wire2.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE_DAYS)
  };
  const appAPI = {
    getVersion: () => wire2.invoke(IpcChannels.APP_GET_VERSION),
    minimize: () => wire2.invoke(IpcChannels.APP_MINIMIZE),
    maximize: () => wire2.invoke(IpcChannels.APP_MAXIMIZE),
    close: () => wire2.invoke(IpcChannels.APP_CLOSE),
    showWindow: () => wire2.invoke(IpcChannels.APP_SHOW_WINDOW),
    hideWindow: () => wire2.invoke(IpcChannels.APP_HIDE_WINDOW),
    setTitleBarTheme: (theme) => wire2.invoke(IpcChannels.APP_SET_TITLE_BAR_THEME, theme),
    /**
     * `process` exists in the preload context, but not in a page the headless daemon serves:
     * a browser tab or the Windows shell loading `/ui/` died at module scope with
     * "process is not defined" and left the window black. This field only says where the
     * system caption buttons sit, so off the desktop the honest answer is "none here".
     */
    platform: typeof process === "undefined" ? "browser" : process.platform,
    openExternal: (url) => wire2.invoke(IpcChannels.APP_OPEN_EXTERNAL, url),
    checkUpdate: () => wire2.invoke(IpcChannels.APP_CHECK_UPDATE),
    downloadUpdate: () => wire2.invoke(IpcChannels.APP_DOWNLOAD_UPDATE),
    installUpdate: () => wire2.invoke(IpcChannels.APP_INSTALL_UPDATE),
    getUpdateStatus: () => wire2.invoke(IpcChannels.APP_GET_UPDATE_STATUS),
    onUpdateChecking: (callback) => {
      const listener = (_event) => callback();
      wire2.on(IpcChannels.APP_UPDATE_CHECKING, listener);
      return () => wire2.off(IpcChannels.APP_UPDATE_CHECKING, listener);
    },
    onUpdateAvailable: (callback) => {
      const listener = (_event, info) => callback(info);
      wire2.on(IpcChannels.APP_UPDATE_AVAILABLE, listener);
      return () => wire2.off(IpcChannels.APP_UPDATE_AVAILABLE, listener);
    },
    onUpdateNotAvailable: (callback) => {
      const listener = (_event, info) => callback(info);
      wire2.on(IpcChannels.APP_UPDATE_NOT_AVAILABLE, listener);
      return () => wire2.off(IpcChannels.APP_UPDATE_NOT_AVAILABLE, listener);
    },
    onUpdateProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      wire2.on(IpcChannels.APP_UPDATE_PROGRESS, listener);
      return () => wire2.off(IpcChannels.APP_UPDATE_PROGRESS, listener);
    },
    onUpdateDownloaded: (callback) => {
      const listener = (_event, info) => callback(info);
      wire2.on(IpcChannels.APP_UPDATE_DOWNLOADED, listener);
      return () => wire2.off(IpcChannels.APP_UPDATE_DOWNLOADED, listener);
    },
    onUpdateError: (callback) => {
      const listener = (_event, error) => callback(error);
      wire2.on(IpcChannels.APP_UPDATE_ERROR, listener);
      return () => wire2.off(IpcChannels.APP_UPDATE_ERROR, listener);
    }
  };
  const configAPI = {
    get: () => wire2.invoke(IpcChannels.CONFIG_GET),
    update: (updates) => wire2.invoke(IpcChannels.CONFIG_UPDATE, updates),
    onConfigChanged: (callback) => {
      const handler = (_event, config) => callback(config);
      wire2.on(IpcChannels.CONFIG_CHANGED, handler);
      return () => wire2.off(IpcChannels.CONFIG_CHANGED, handler);
    }
  };
  const anthropicDiscoveryAPI = {
    plan: () => wire2.invoke(IpcChannels.ANTHROPIC_DISCOVERY_PLAN),
    apply: () => wire2.invoke(IpcChannels.ANTHROPIC_DISCOVERY_APPLY)
  };
  const routesAPI = {
    list: () => wire2.invoke(IpcChannels.ROUTES_LIST),
    create: (input) => wire2.invoke(IpcChannels.ROUTES_CREATE, input),
    // `currentName` 是现在盘上的规范名；`patch.name` 才是改名。
    update: (currentName, patch) => wire2.invoke(IpcChannels.ROUTES_UPDATE, currentName, patch),
    // 命名跟随 `providers:delete` / `accounts:delete` → `delete()`，与通道名一一对应。
    delete: (name) => wire2.invoke(IpcChannels.ROUTES_DELETE, name),
    // 只算不写：用和生产请求同一条采集/策略/手动增删管线，返回逐模型状态。
    preview: (route, sample) => wire2.invoke(IpcChannels.ROUTES_PREVIEW, route, sample),
    // 只算不写：一次采集折全表，返回每条路由的候选模型数（列表页要的是数字，不是明细）。
    poolSizes: () => wire2.invoke(IpcChannels.ROUTES_POOL_SIZES)
  };
  const sessionAPI = {
    getConfig: () => wire2.invoke(IpcChannels.SESSION_GET_CONFIG),
    updateConfig: (config) => wire2.invoke(IpcChannels.SESSION_UPDATE_CONFIG, config),
    getAll: () => wire2.invoke(IpcChannels.SESSION_GET_ALL),
    getActive: () => wire2.invoke(IpcChannels.SESSION_GET_ACTIVE),
    getById: (id2) => wire2.invoke(IpcChannels.SESSION_GET_BY_ID, id2),
    getByAccount: (accountId) => wire2.invoke(IpcChannels.SESSION_GET_BY_ACCOUNT, accountId),
    getByProvider: (providerId) => wire2.invoke(IpcChannels.SESSION_GET_BY_PROVIDER, providerId),
    delete: (id2) => wire2.invoke(IpcChannels.SESSION_DELETE, id2),
    clearAll: () => wire2.invoke(IpcChannels.SESSION_CLEAR_ALL),
    cleanExpired: () => wire2.invoke(IpcChannels.SESSION_CLEAN_EXPIRED)
  };
  const managementApiAPI = {
    getConfig: () => wire2.invoke(IpcChannels.MANAGEMENT_API_GET_CONFIG),
    updateConfig: (updates) => wire2.invoke(IpcChannels.MANAGEMENT_API_UPDATE_CONFIG, updates),
    generateSecret: () => wire2.invoke(IpcChannels.MANAGEMENT_API_GENERATE_SECRET)
  };
  const contextManagementAPI = {
    getConfig: () => wire2.invoke(IpcChannels.CONTEXT_MANAGEMENT_GET_CONFIG),
    updateConfig: (updates) => wire2.invoke(IpcChannels.CONTEXT_MANAGEMENT_UPDATE_CONFIG, updates)
  };
  const trayAPI = {
    openDashboard: () => wire2.send("tray:open-dashboard"),
    setHeight: (height) => wire2.send("tray:set-height", height),
    quitApp: () => wire2.send("tray:quit-app")
  };
  const modelRefreshAPI = {
    getStatus: () => wire2.invoke(IpcChannels.MODEL_REFRESH_GET_STATUS),
    triggerNow: () => wire2.invoke(IpcChannels.MODEL_REFRESH_TRIGGER_NOW)
  };
  const aggregateAPI = {
    list: () => wire2.invoke(IpcChannels.AGGREGATE_LIST),
    save: (input) => wire2.invoke(IpcChannels.AGGREGATE_SAVE, input),
    setEnabled: (id2, enabled) => wire2.invoke(IpcChannels.AGGREGATE_SET_ENABLED, id2, enabled),
    remove: (id2) => wire2.invoke(IpcChannels.AGGREGATE_REMOVE, id2),
    test: (id2) => wire2.invoke(IpcChannels.AGGREGATE_TEST, id2),
    // 在线同步模型清单：多把 Key 轮换探测，把上游新模型并入条目清单。
    syncModels: (id2) => wire2.invoke(IpcChannels.AGGREGATE_SYNC_MODELS, id2),
    detail: (id2) => wire2.invoke(IpcChannels.AGGREGATE_DETAIL, id2),
    addKey: (id2, apiKey) => wire2.invoke(IpcChannels.AGGREGATE_ADD_KEY, id2, apiKey),
    removeKey: (accountId) => wire2.invoke(IpcChannels.AGGREGATE_REMOVE_KEY, accountId),
    setKeyEnabled: (accountId, enabled) => wire2.invoke(IpcChannels.AGGREGATE_SET_KEY_ENABLED, accountId, enabled),
    validateKey: (id2, accountId) => wire2.invoke(IpcChannels.AGGREGATE_VALIDATE_KEY, id2, accountId),
    addModel: (id2, modelId) => wire2.invoke(IpcChannels.AGGREGATE_ADD_MODEL, id2, modelId),
    removeModel: (id2, modelId) => wire2.invoke(IpcChannels.AGGREGATE_REMOVE_MODEL, id2, modelId),
    setModelEnabled: (id2, modelId, enabled) => wire2.invoke(IpcChannels.AGGREGATE_SET_MODEL_ENABLED, id2, modelId, enabled),
    setModelParams: (id2, modelId, params) => wire2.invoke(IpcChannels.AGGREGATE_SET_MODEL_PARAMS, id2, modelId, params),
    testModel: (id2, modelId) => wire2.invoke(IpcChannels.AGGREGATE_TEST_MODEL, id2, modelId),
    // 账号级实时额度：点一次问一次。没有轮询通道，也没有开页自动发。
    queryCredits: (id2) => wire2.invoke(IpcChannels.AGGREGATE_QUERY_CREDITS, id2)
  };
  const channelsAPI = {
    list: () => wire2.invoke(IpcChannels.CHANNELS_LIST),
    // 每家渠道账号池的计数（不含账号列表，也不读模型目录）：供应商卡片上的
    // 「已启用 / 全部」用这一份，而不是本地账号表里那一条占位账号。
    accountCounts: () => wire2.invoke(IpcChannels.CHANNELS_ACCOUNT_COUNTS),
    rpc: (method, payload) => wire2.invoke(IpcChannels.CHANNELS_RPC, method, payload),
    credits: (id2) => wire2.invoke(IpcChannels.CHANNELS_CREDITS, id2),
    // 一次问完多家渠道的积分：远程 UI 上这是 1 笔管理面请求，而不是每家 1 笔。
    // 单家的失败在 results 里是 `error` 字段，不会让整页一起失败。
    creditsAll: (ids) => wire2.invoke(IpcChannels.CHANNELS_CREDITS_ALL, ids),
    setEnabled: (id2, enabled) => wire2.invoke(IpcChannels.CHANNELS_SET_ENABLED, id2, enabled),
    remove: (id2) => wire2.invoke(IpcChannels.CHANNELS_REMOVE, id2),
    // 省略参数 = 读；给出布尔 = 改写「每日自动领取签到积分」开关。
    autoCheckin: (enabled) => wire2.invoke(IpcChannels.CHANNELS_AUTO_CHECKIN, enabled),
    // 在线模型目录（含积分权重与免费标记），以及强制重拉这一个渠道。
    models: (id2) => wire2.invoke(IpcChannels.CHANNELS_MODELS, id2),
    refreshModels: (id2) => wire2.invoke(IpcChannels.CHANNELS_REFRESH_MODELS, id2),
    // 模型开关与失效恢复：返回结果里带最新目录，界面不必再单独拉一次。
    setModelDisabled: (id2, modelId, disabled) => wire2.invoke(IpcChannels.CHANNELS_SET_MODEL_DISABLED, id2, modelId, disabled),
    clearDeadModels: (id2, modelId) => wire2.invoke(IpcChannels.CHANNELS_CLEAR_DEAD_MODELS, id2, modelId),
    onChanged: (callback) => {
      const handler = () => callback();
      wire2.on(IpcChannels.CHANNELS_CHANGED, handler);
      return () => wire2.off(IpcChannels.CHANNELS_CHANGED, handler);
    }
  };
  const electronAPI = {
    proxy: proxyAPI,
    tls: tlsAPI,
    store: storeAPI,
    backup: backupAPI,
    providers: providersAPI,
    aggregate: aggregateAPI,
    channels: channelsAPI,
    accounts: accountsAPI,
    oauth: oauthAPI,
    logs: logsAPI,
    requestLogs: requestLogsAPI,
    statistics: statisticsAPI,
    app: appAPI,
    config: configAPI,
    anthropicDiscovery: anthropicDiscoveryAPI,
    routes: routesAPI,
    session: sessionAPI,
    managementApi: managementApiAPI,
    contextManagement: contextManagementAPI,
    tray: trayAPI,
    modelRefresh: modelRefreshAPI
    // 这里刻意**没有**通用的 `invoke` / `send` / `on`。曾经有，等于把整个 `ipcRenderer`
    // 原样交给渲染进程：任何在渲染层执行的 JS 都能调用全部通道，包括
    // `accounts:get-all(true)`（拿解密后的凭据）与 `store:set('accounts', …)`（绕过加密写盘），
    // `contextIsolation` 的收益被抵消大半。现在渲染层只能走上面这些具名方法，
    // 要新增通道就必须在 preload 显式登记 + 在 `shared/types` / `electron.d.ts` 里带上类型。
  };
  return electronAPI;
}
function parseEventFrame(frame) {
  let channel = null;
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) channel = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (channel === null || channel === "" || dataLines.length === 0) return null;
  try {
    return { channel, payload: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
const SECRET_KEY = "modelport.managementSecret";
const UNAUTHORIZED = "modelport:unauthorized";
function hasManagementSecret() {
  return sessionStorage.getItem(SECRET_KEY) !== null;
}
function setManagementSecret(secret2) {
  if (secret2.trim() === "") sessionStorage.removeItem(SECRET_KEY);
  else sessionStorage.setItem(SECRET_KEY, secret2.trim());
}
function secret() {
  return sessionStorage.getItem(SECRET_KEY) ?? "";
}
function forgetSecret() {
  sessionStorage.removeItem(SECRET_KEY);
  void shellBridge()?.forgetGatewaySecret(location.origin);
  window.dispatchEvent(new Event(UNAUTHORIZED));
}
function shellBridge() {
  const host = window;
  const bridge = host.modelportShell;
  return bridge && typeof bridge.getGatewaySecret === "function" ? bridge : null;
}
function secretCanRemember() {
  return shellBridge() !== null;
}
async function loadRememberedSecret() {
  const bridge = shellBridge();
  if (!bridge) return false;
  try {
    const found = await bridge.getGatewaySecret(location.origin);
    if (found.status !== "found" || !found.secret) return false;
    setManagementSecret(found.secret);
    return true;
  } catch {
    return false;
  }
}
function rememberSecret(secret2) {
  void shellBridge()?.setGatewaySecret(location.origin, secret2);
}
const unauthorizedEventName = UNAUTHORIZED;
async function probeGateway() {
  const response = await fetch("/v1/management/rpc/channels", {
    headers: { "X-Management-Secret": secret() }
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) throw new Error(`gateway responded ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.data) ? body.data.length : 0;
}
const inFlightRpc = /* @__PURE__ */ new Map();
function rpcKey(channel, args) {
  try {
    return `${channel}\0${JSON.stringify(args)}`;
  } catch {
    return `${channel}\0<unserializable:${Date.now()}:${Math.random()}>`;
  }
}
function retryDelayMs(response, body) {
  const fromBody = body?.error?.retryAfterMs;
  if (typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody > 0) {
    return Math.min(fromBody, 5e3);
  }
  const header2 = response.headers.get("Retry-After");
  const seconds = header2 === null ? Number.NaN : Number(header2);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1e3, 5e3);
  }
  return 1e3;
}
const gateUntilByKey = /* @__PURE__ */ new Map();
async function waitForGate(key) {
  for (; ; ) {
    const until = gateUntilByKey.get(key);
    if (until === void 0) return;
    const wait = until - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    gateUntilByKey.delete(key);
    return;
  }
}
async function invokeOnce(channel, args, key, retried = false) {
  await waitForGate(key);
  const response = await fetch("/v1/management/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Management-Secret": secret() },
    body: JSON.stringify({ channel, args })
  });
  if (response.status === 401) {
    forgetSecret();
    throw new Error("management secret rejected");
  }
  const body = await response.json().catch(() => null);
  if (response.status === 429) {
    const delay = retryDelayMs(response, body);
    gateUntilByKey.set(key, Math.max(gateUntilByKey.get(key) ?? 0, Date.now() + delay));
    if (!retried) return invokeOnce(channel, args, key, true);
  }
  if (!body) throw new Error(`rpc ${channel}: empty response (${response.status})`);
  if (!body.success) {
    const code = body.error?.code ?? "rpc_failed";
    throw Object.assign(new Error(body.error?.message ?? code), { code });
  }
  return body.data;
}
function invoke(channel, ...args) {
  const key = rpcKey(channel, args);
  const existing = inFlightRpc.get(key);
  if (existing) return existing;
  const pending = invokeOnce(channel, args, key);
  inFlightRpc.set(key, pending);
  const settle = () => {
    if (inFlightRpc.get(key) === pending) inFlightRpc.delete(key);
  };
  pending.then(settle, settle);
  return pending;
}
function chooseBackupFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    let settled = false;
    const done = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}
async function uploadBackup() {
  const file = await chooseBackupFile();
  if (!file) return { canceled: true };
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw Object.assign(new Error(`${file.name} is empty`), { code: "empty-file" });
  }
  const response = await fetch("/v1/management/backup/stage", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Management-Secret": secret() },
    body: bytes
  });
  if (response.status === 401) {
    forgetSecret();
    throw new Error("management secret rejected");
  }
  const body = await response.json().catch(() => null);
  if (!body) {
    console.error(`[headless] backup stage: ${bytes.byteLength} bytes sent, gateway replied ${response.status} without an envelope`);
    throw Object.assign(new Error(`backup stage unavailable (${response.status})`), {
      code: "upload-unavailable"
    });
  }
  if (!body.success) {
    console.error(`[headless] backup stage refused: ${JSON.stringify(body.error)} for ${bytes.byteLength} bytes`);
    throw Object.assign(new Error(body.error?.message ?? "stage_failed"), {
      code: body.error?.code ?? "stage_failed"
    });
  }
  return body.data;
}
const listeners = /* @__PURE__ */ new Map();
let streamReader = null;
let streamAbort = null;
async function readEvents(signal) {
  let backoffMs = 1e3;
  while (!signal.aborted) {
    try {
      const response = await fetch("/v1/management/events", {
        headers: { "X-Management-Secret": secret() },
        signal
      });
      if (response.status === 401) {
        forgetSecret();
        return;
      }
      if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
      backoffMs = 1e3;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          applyFrame(frame);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
    }
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    backoffMs = Math.min(backoffMs * 2, 15e3);
  }
}
function applyFrame(frame) {
  const event = parseEventFrame(frame);
  if (!event) return;
  for (const listener of listeners.get(event.channel) ?? []) listener(null, event.payload);
}
function ensureStream() {
  if (streamReader) return;
  streamAbort = new AbortController();
  streamReader = readEvents(streamAbort.signal);
}
const wire = {
  invoke,
  on: (channel, handler) => {
    const set = listeners.get(channel) ?? /* @__PURE__ */ new Set();
    set.add(handler);
    listeners.set(channel, set);
    ensureStream();
  },
  off: (channel, handler) => {
    listeners.get(channel)?.delete(handler);
  },
  // The tray window is an Electron surface; a browser client has no tray to talk to.
  send: () => void 0,
  uploadBackup
};
function installHeadlessApi() {
  const target = window;
  if (target.electronAPI) return false;
  target.electronAPI = createElectronAPI(wire);
  target.__MODELPORT_REMOTE__ = true;
  return true;
}
function ConnectGate({
  remote,
  children
}) {
  const { t: t2 } = useTranslation();
  const [ready, setReady] = reactExports.useState(() => !remote || hasManagementSecret());
  const [retrieving, setRetrieving] = reactExports.useState(remote && !hasManagementSecret());
  const [value, setValue] = reactExports.useState("");
  const [error, setError] = reactExports.useState(null);
  const [checking, setChecking] = reactExports.useState(false);
  reactExports.useEffect(() => {
    if (!retrieving) return;
    void (async () => {
      const found = await loadRememberedSecret();
      setRetrieving(false);
      if (found) setReady(true);
    })();
  }, [retrieving]);
  reactExports.useEffect(() => {
    if (!remote) return;
    const onUnauthorized = () => {
      setReady(false);
      setError(t2("connect.unauthorized"));
    };
    window.addEventListener(unauthorizedEventName, onUnauthorized);
    return () => window.removeEventListener(unauthorizedEventName, onUnauthorized);
  }, [remote, t2]);
  if (retrieving) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex min-h-screen items-center justify-center bg-background p-6", children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t2("connect.retrieving") }) });
  }
  if (!ready) {
    const submit = async () => {
      setChecking(true);
      setError(null);
      setManagementSecret(value);
      try {
        await probeGateway();
        rememberSecret(value);
        setReady(true);
      } catch (cause) {
        setManagementSecret("");
        setError(
          cause.message === "unauthorized" ? t2("connect.unauthorized") : t2("connect.unreachable", { message: cause.message })
        );
      } finally {
        setChecking(false);
      }
    };
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex min-h-screen items-center justify-center bg-background p-6", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "form",
      {
        onSubmit: (event) => {
          event.preventDefault();
          void submit();
        },
        className: "w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-lg font-semibold text-foreground", children: t2("connect.title") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t2("connect.subtitle") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block space-y-1", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-foreground", children: t2("connect.secretLabel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                autoFocus: true,
                type: "password",
                value,
                onChange: (event) => setValue(event.target.value),
                placeholder: "mgmt_...",
                className: "w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              }
            )
          ] }),
          error && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-red-400", children: error }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "submit",
              disabled: checking || value.trim() === "",
              className: "w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50",
              children: checking ? t2("connect.connecting") : t2("connect.submit")
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t2("connect.daemonKeepsRunning") }),
          secretCanRemember() && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t2("connect.remembered") })
        ]
      }
    ) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children });
}
function ThemeProvider({ children }) {
  const theme = useSettingsStore((state) => state.theme);
  reactExports.useEffect(() => {
    const root = window.document.documentElement;
    const applyTheme = (t2) => {
      root.setAttribute("data-theme", t2);
    };
    const getSystemTheme = () => {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    if (theme === "system") {
      applyTheme(getSystemTheme());
    } else {
      applyTheme(theme);
    }
  }, [theme]);
  reactExports.useEffect(() => {
    if (theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => {
      const root = window.document.documentElement;
      root.setAttribute("data-theme", e.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children });
}
const isRemoteGateway = installHeadlessApi();
client.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(React$1.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(ErrorBoundary, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(ThemeProvider, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(ConnectGate, { remote: isRemoteGateway, children: /* @__PURE__ */ jsxRuntimeExports.jsx(HashRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(App, {}) }) }) }) }) })
);
export {
  validateSanHosts as $,
  Dialog as A,
  Button as B,
  Check as C,
  DismissableLayer as D,
  ExternalLink as E,
  FileText as F,
  DialogContent as G,
  DialogHeader as H,
  DialogTitle as I,
  DialogDescription as J,
  DialogFooter as K,
  Root as L,
  createSlot$1 as M,
  useToast as N,
  useProvidersStore as O,
  Presence as P,
  localAccountCounts as Q,
  ReactRemoveScroll as R,
  Server as S,
  TriangleAlert as T,
  mergeChannelCounts as U,
  KeyRound as V,
  Wifi as W,
  X,
  normalizeSanHostList as Y,
  Zap as Z,
  buildHttpsUrl as _,
  cn as a,
  Play as a0,
  Square as a1,
  Cpu as a2,
  toast as a3,
  useNavigationStore as a4,
  useSearchParams as a5,
  Network as a6,
  cva as a7,
  useTheme as a8,
  Sun as a9,
  Moon as aa,
  RotateCw as ab,
  DialogTrigger as ac,
  SETTINGS_STORAGE_KEY as ad,
  sanitizePersistedSettings as ae,
  pickPersistedPreferences as af,
  buildExportEnvelope as ag,
  parseExportEnvelope as ah,
  LEGACY_SETTINGS_STORAGE_KEY as ai,
  logoIcon as aj,
  reactDomExports as ak,
  VISUALLY_HIDDEN_STYLES as al,
  Settings2 as b,
  createLucideIcon as c,
  create as d,
  useNavigate as e,
  useSettingsStore as f,
  composeRefs as g,
  useCallbackRef$1 as h,
  createContextScope as i,
  jsxRuntimeExports as j,
  Portal$1 as k,
  useComposedRefs as l,
  composeEventHandlers as m,
  Primitive as n,
  createCollection as o,
  hideOthers as p,
  dispatchDiscreteCustomEvent as q,
  reactExports as r,
  useFocusGuards as s,
  FocusScope as t,
  useTranslation as u,
  useControllableState as v,
  useId as w,
  Settings$1 as x,
  Copy as y,
  useLayoutEffect2 as z
};
