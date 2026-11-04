// The session card's picture: a plain A320 cockpit seen from just behind the seats at the pilots'
// eye height, looking ahead and a little down, the host in the left seat with a hand on the
// thrust levers and the crewmate, once there is one, in the right. Every surface is the card's
// color and the light alone shades it. The pictures are rendered ahead of time, at twice the
// picture's size, with the windows left clear, and the sky behind them is drawn here: the card's
// color with the main color glowing down from the top, so it follows the theme. Over the
// pictures, in the windshield between the heads, goes whatever's given, such as the invite code.
import alone from "./cockpit-picture/alone.png"
import crew from "./cockpit-picture/crew.png"

export const PICTURE = { width: 436, height: 250 }

export function CockpitPicture({ crewmate, children }: { crewmate: boolean; children?: React.ReactNode }) {
  return (
    <div
      className="relative mx-auto shrink-0 overflow-hidden"
      style={{
        width: PICTURE.width,
        height: PICTURE.height,
        background: "radial-gradient(ellipse 70% 60% at 50% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent), var(--card)",
      }}
    >
      <img src={crewmate ? crew : alone} alt="" className="absolute top-0 left-0 block" style={{ width: PICTURE.width, height: PICTURE.height }} />
      {children}
    </div>
  )
}
