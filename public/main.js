/*global UIkit, Vue, AUTH_TOKEN */

(() => {
  const notification = (config) =>
    UIkit.notification({
      pos: "top-right",
      timeout: 5000,
      ...config,
    });

  const alert = (message) =>
    notification({
      message,
      status: "danger",
    });

  const info = (message) =>
    notification({
      message,
      status: "success",
    });

  const fetchJson = (...args) =>
    fetch(...args)
      .then((res) =>
        res.ok
          ? res.status !== 204
            ? res.json()
            : null
          : res.text().then((text) => {
              throw new Error(text);
            })
      )
      .catch((err) => {
        alert(err.message);
      });

  new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: [],
      oldTimers: [],
    },
    methods: {
      createTimer() {
        const description = this.desc;
        this.desc = "";
        fetchJson("/api/timers", {
          method: "post",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description }),
        }).then(({ id }) => {
          info(`Created new timer "${description}" [${id}]`);
        });
      },
      stopTimer(id) {
        fetchJson(`/api/timers/${id}/stop`, {
          method: "post",
        }).then(() => {
          info(`Stopped the timer [${id}]`);
        });
      },
      formatTime(ts) {
        return new Date(ts).toTimeString().split(" ")[0];
      },
      formatDuration(d) {
        d = Math.floor(d / 1000);
        const s = d % 60;
        d = Math.floor(d / 60);
        const m = d % 60;
        const h = Math.floor(d / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
    },
    created() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}`);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token: AUTH_TOKEN }));
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "all_timers") {
          this.activeTimers = message.timers.filter((timer) => timer.isActive);
          this.oldTimers = message.timers.filter((timer) => !timer.isActive);
        }

        if (message.type === "active_timers") {
          this.activeTimers = message.timers;
        }

        if (message.type === "auth_error" || message.type === "error") {
          alert(message.error);
        }
      });

      socket.addEventListener("error", () => alert("WebSocket connection error"));
      this.socket = socket;
    },
    beforeDestroy() {
      if (this.socket) this.socket.close();
    },
  });
})();
