import { execFileSync } from "node:child_process";

/* 发布包的 tar 参数。
 *
 * ⚠️ macOS 自带的是 bsdtar，Ubuntu CI 是 GNU tar。
 * 「属主写成 0」不是同一组选项：
 *   · bsdtar：`--uid 0 --gid 0`，另外要 `--no-mac-metadata`，否则会把 AppleDouble 写进包里。
 *     这组就是原来 macOS 上在用的，原样留着。
 *   · GNU tar **没有** `--uid`，也没有 `--no-mac-metadata`。
 *     实测（本机 GNU tar 1.35，以及 CI job 125716416373）：
 *     `tar: unrecognized option '--uid'`，退出码 64。
 *     对应写法是 `--owner=0 --group=0`。
 * `--numeric-owner` 和 `--no-xattrs` 两边都有。
 * 时间戳不在这里用 `--mtime`：macOS bsdtar 3.5 没有这个选项，由调用方 `utimesSync` 定死。
 *
 * 认不出来就失败，不猜。猜错的参数会在另一台机器上把「可复现的包」打成另一个哈希，
 * 或者根本打不出来。 */

const BSD_OWNER = ["--uid", "0", "--gid", "0", "--numeric-owner", "--no-mac-metadata", "--no-xattrs"];
const GNU_OWNER = ["--owner=0", "--group=0", "--numeric-owner", "--no-xattrs"];

function tarHelpText() {
  try {
    return execFileSync("tar", ["--help"], { encoding: "utf8" });
  } catch (error) {
    const stdout = error.stdout == null ? "" : String(error.stdout);
    const stderr = error.stderr == null ? "" : String(error.stderr);
    return `${stdout}\n${stderr}`;
  }
}

export function tarFlavorFromHelp(help) {
  const hasUid = /--uid\b/.test(help);
  const hasOwner = /--owner\b/.test(help);
  const hasMac = /--no-mac-metadata\b/.test(help);
  if (hasMac && hasUid) return "bsd";
  if (hasOwner && !hasUid) return "gnu";
  return "unknown";
}

export function tarFlavor() {
  return tarFlavorFromHelp(tarHelpText());
}

export function releaseTarArgs({ stage, archive, filelist, flavor = tarFlavor() }) {
  return ["--format", "ustar", ...ownerFlags(flavor), "-C", stage, "-cf", archive, "-T", filelist];
}

function ownerFlags(flavor) {
  switch (flavor) {
    case "gnu":
      return GNU_OWNER;
    case "bsd":
      return BSD_OWNER;
    case "unknown":
      throw new Error("不认识的 tar，不猜打包参数。`tar --help` 里需要能看出是 GNU tar 还是 macOS bsdtar。\n" + tarHelpText());
    default: {
      const never = flavor;
      throw new Error(`未处理的 tar 种类：${String(never)}`);
    }
  }
}
