import GMToolkit from "./gm-toolkit.mjs"
import { inActiveCombat } from "./utility.mjs"

export default class Advantage {

  /**
   * Entry point for adjustments to Advantage through .
   * @param {Object} character   :   Token
   * @param {string} adjustment  :   increase (+1), clear (=0), reduce (-1)
   * // TODO: add support for numeric adjustment values
   * @param {string} context     :   macro, wfrp4e:opposedTestResult, wfrp4e:applyDamage, createCombatant, preDeleteCombatant, createActiveEffect, loseMomentum
   * @returns {Array} update     :   outcome (String: increased, reduced, min, max, reset, no change),
   *                                 starting (Number: what the character's Advantage was at the start of the routine)
   *                                 new (Number: what the character's Advantage is at the end of the routine)
   **/
  /**
   * Entry point for adjustments to Advantage.
   * @param {Object} character   : Token
   * @param {string|number} adjustment : increase (+1), clear (=0), reduce (-1), oppure delta numerico (+N / -N)
   * @param {string} context     : macro, wfrp4e:opposedTestResult, wfrp4e:applyDamage, createCombatant, preDeleteCombatant, createActiveEffect, loseMomentum, opposedLedger
   * @returns {Array} update     : outcome (String), starting (Number), new (Number)
   **/
  static async update (character, adjustment, context = "macro") {
    if (adjustment === null || adjustment === undefined) return

    if (
      (character === undefined)
      || (character?.document?.documentName !== "Token")
      || (context === "macro" && canvas.tokens.controlled.length !== 1)
    ) {
      return ui.notifications.error(game.i18n.localize("GMTOOLKIT.Token.SingleSelect"), { console: true })
    }

    const isNumericAdjustment = Number.isInteger(adjustment)

    // Not in combat, unless clearing or applying a negative/zero numeric correction
    if (!character.inCombat && adjustment !== "clear" && !(isNumericAdjustment && adjustment <= 0)) {
      return ui.notifications.error(
        `${game.i18n.format("GMTOOLKIT.Advantage.NotInCombat", {
          actorName: character.name,
          sceneName: game.scenes.viewed.name
        })}`,
        { console: true }
      )
    }

    const characterInfo = { name: character.name }
    characterInfo.advantage = {
      personal: {
        current: Number(character.actor.status.advantage.value ?? 0),
        max: character.actor.status.advantage.max
      },
      group: {
        affiliation: character.actor.advantageGroup,
        current: await game.settings.get("wfrp4e", "groupAdvantageValues")[character.actor.advantageGroup]
      }
    }

    GMToolkit.log(false, characterInfo)

    const updatedAdvantage = await this.adjust(
      character,
      characterInfo.advantage.personal,
      adjustment
    )

    const update = await this.report(
      updatedAdvantage,
      character,
      characterInfo.advantage.personal,
      context
    )

    update.outcome = updatedAdvantage.outcome
    update.new = updatedAdvantage.new
    update.starting = updatedAdvantage.starting
    GMToolkit.log(false, update)
    return update
  }

  static async adjust (character, advantage, adjustment) {
    GMToolkit.log(false, `Attempting to adjust Advantage for ${character.name} from ${advantage.current} with`, adjustment)

    const starting = Number(advantage.current ?? 0)
    let outcome = ""
    let newValue = starting

    const usingGroupAdvantage = game.settings.get("wfrp4e", "useGroupAdvantage")
    const maxValue = advantage.max

    // Numeric delta support
    if (Number.isInteger(adjustment)) {
      let target = starting + adjustment

      if (target < 0) target = 0
      if (!usingGroupAdvantage && maxValue !== undefined && target > maxValue) target = maxValue

      if (target === starting) {
        if (adjustment > 0 && !usingGroupAdvantage && maxValue !== undefined && starting >= maxValue) {
          outcome = "max"
        } else if (adjustment < 0 && starting <= 0) {
          outcome = "min"
        } else {
          outcome = "nochange"
        }
      } else {
        newValue = Number(target)
        const updated = await updateCharacterAdvantage(newValue)

        if (!updated) {
          outcome = "nochange"
        } else if (newValue === 0 && starting > 0) {
          outcome = "reset"
        } else if (newValue > starting) {
          outcome = "increased"
        } else {
          outcome = "reduced"
        }
      }

      return {
        outcome,
        starting,
        new: newValue
      }
    }

    // Legacy string adjustments
    switch (adjustment) {
      case "increase":
        if (usingGroupAdvantage || maxValue === undefined || starting < maxValue) {
          newValue = Number(starting + 1)
          const updated = await updateCharacterAdvantage(newValue)
          outcome = updated ? "increased" : "nochange"
        } else {
          outcome = "max"
        }
        break

      case "reduce":
        if (starting > 0) {
          newValue = Number(starting - 1)
          const updated = await updateCharacterAdvantage(newValue)
          outcome = updated ? "reduced" : "nochange"
        } else {
          outcome = "min"
        }
        break

      case "clear":
        if (starting === 0) {
          outcome = "min"
        } else {
          newValue = 0
          const updated = await updateCharacterAdvantage(newValue)
          outcome = updated ? "reset" : "nochange"
        }
        break

      default:
        outcome = "nochange"
        break
    }

    return {
      outcome,
      starting,
      new: newValue
    }

    async function updateCharacterAdvantage (value) {
      let updated = ""

      if (!character.actor.isOwner) {
        return updated = await game.socket.emit(
          `module.${GMToolkit.MODULE_ID}`,
          {
            type: "updateAdvantage",
            payload: {
              character: character.actor.id,
              updateData: { "system.status.advantage.value": value }
            }
          }
        )
      } else {
        return updated = await character.actor.update({ "system.status.advantage.value": value })
      }
    }
  }

  static async report (updatedAdvantage, character, resourceBase, context) {
    const update = []
    let type = "success"
    const options = {
      permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications"),
      console: true
    }

    switch (context) {
      case "wfrp4e:opposedTestResult":
        if (updatedAdvantage.outcome === "increased") update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.WonOpposedTest", { actorName: character.name })
        if (updatedAdvantage.outcome === "reset") update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.LostOpposedTest", { actorName: character.name })
        break
      case "loseMomentum":
        update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.LoseMomentum", { actorName: character.name })
        break
      case "createCombatant":
        update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.AddedToCombat", { actorName: character.name })
        break
      case "preDeleteCombatant":
        update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.RemovedFromCombat", { actorName: character.name })
        break
      default:
        break
    }

    switch (updatedAdvantage.outcome) {
      case "increased":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Increased", { actorName: character.name, startingAdvantage: updatedAdvantage.starting, newAdvantage: updatedAdvantage.new })
        break
      case "reduced":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Reduced", { actorName: character.name, startingAdvantage: updatedAdvantage.starting, newAdvantage: updatedAdvantage.new })
        break
      case "reset":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Reset", { actorName: character.name, startingAdvantage: updatedAdvantage.starting })
        break
      case "min":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.None", { actorName: character.name, startingAdvantage: updatedAdvantage.starting })
        type = "info"
        break
      case "max":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Max", { actorName: character.name, startingAdvantage: updatedAdvantage.starting, maxAdvantage: resourceBase.max })
        type = "info"
        break
      case "nochange":
      default:
        update.notice = game.i18n.format("GMTOOLKIT.Message.UnexpectedNoChange")
        type = "warning"
        break
    }

    const message = (update.context ? update.context : "") + update.notice
    // Bypass individual player Advantage updates if Group Advantage is being used
    if (game.user.isGM && !(game.settings.get("wfrp4e", "useGroupAdvantage"))) ui.notifications.notify(message, type, options)
    // Force refresh the token hud if it is visible
    if (character.hasActiveHUD) {await canvas.hud.token.render(true)}
    update.context = (update.context) ? update.context : context
    return update
  }

  /**
   * Clears combatant flags set for increasing token Advantage during combat.
   * @param {Array} advantaged   :   Array of Combatant
   * @param {boolean} startOfRound  :   Unset sorAdvantage flag at end of round
   **/
  static unsetFlags (advantaged, startOfRound = false) {
    advantaged.filter(c => c.unsetFlag(GMToolkit.MODULE_ID, "advantage"))
    if (startOfRound) advantaged.filter(c => c.unsetFlag(GMToolkit.MODULE_ID, "sorAdvantage"))
    GMToolkit.log(false, "Advantage Flags: Unset.")
  }

  static async loseMomentum (combat) {
    let checkNotGained = "" // List of tokens that have not accrued advantage
    let checkGained = "" // List of tokens that have accrued advantage
    let noAdvantage = "" // List of tokens that have no advantage at the end of the round
    let combatantLine = "" // Html string for constructing dialog
    let round = combat.round
    const combatantAdvantage = []

    combat.combatants.forEach(combatant => {
      combatantAdvantage.startOfRound = combatant.getFlag(GMToolkit.MODULE_ID, "sorAdvantage")
      // eslint-disable-next-line max-len
      combatantAdvantage.endOfRound = combatant.token.actor.system.status?.advantage?.value
      const checkToLoseMomentum
        = (combatantAdvantage.endOfRound - combatantAdvantage.startOfRound > 0)
          ? false
          : "checked"

      // TODO: Define and replace the inline styles within the stylesheet
      if (!combatantAdvantage.endOfRound) {
        noAdvantage += `<img src="${combatant.img}" style = "height: 2rem; border: none; padding-right: 2px; padding-left: 2px; max-width: fit-content;" alt="${combatant.name}" title="${combatant.name}">&nbsp;${combatant.name}</img>`
      } else {
        combatantLine = `
                <div class="form-group">
                <input type="checkbox" id="${combatant.tokenId}" name="${combatant.tokenId}" value="${combatant.name}" ${checkToLoseMomentum}> 
                <img src="${combatant.img}" style = "height: 2rem; vertical-align : middle; border: none; padding-right: 6px; padding-left: 2px; max-width: fit-content;" />
                <label for="${combatant.tokenId}" style = "text-align: left;  border: none;">  <strong>${combatant.name}</strong></label>
                <label for="${combatant.tokenId}"  style = "text-align: left;  border: none;"> ${combatantAdvantage.startOfRound} &rarr; ${combatantAdvantage.endOfRound} </label>
                </div>
                `;
        (checkToLoseMomentum)
          ? checkNotGained += combatantLine
          : checkGained += combatantLine
      }
    })

    // Exit without prompt if no combatant has Advantage to lose
    if (checkGained === "" && checkNotGained === "") {
      const uiNotice = game.i18n.format("GMTOOLKIT.Message.Advantage.NoCombatantsWithAdvantage", { combatRound: round })
      if (game.user.isGM) {ui.notifications.notify(uiNotice, "info", { permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications") }, { console: true } )}
      return
    }

    // Explain empty dialog sections
    if (checkGained === "") checkGained = `<div class="form-group">${game.i18n.localize("GMTOOLKIT.Message.Advantage.NoCombatantsAccruedAdvantage")}</div>`
    if (checkNotGained === "") checkNotGained = `<div class="form-group">${game.i18n.localize("GMTOOLKIT.Message.Advantage.NoCombatantsNotAccruedAdvantage")}</div>`
    if (noAdvantage === "") noAdvantage = game.i18n.localize("GMTOOLKIT.Message.Advantage.NoCombatantsWithoutAdvantage")

    const templateData = {
      gained: checkGained,
      notgained: checkNotGained,
      none: noAdvantage
    }
    const dialogContent = await renderTemplate("modules/wfrp4e-gm-toolkit-dk-fix/templates/gm-toolkit-advantage-momentum.html", templateData)
    let lostAdvantage = ""

    foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("GMTOOLKIT.Dialog.Advantage.LoseMomentum.Title", { combatRound: round }) },
      rejectClose: false,
      content: dialogContent,
      buttons: [
        {
          label: game.i18n.localize("GMTOOLKIT.Dialog.Advantage.LoseMomentum.Button"),
          action: "reduceAdvantage",
          callback: async (event, button, dialog) => {
            const response = new foundry.applications.ux
              .FormDataExtended(button.form).object
            // Reduce advantage for selected combatants
            for ( const combatant of combat.combatants ) {
              if (response[combatant.tokenId] === combatant.name) {
                const token = canvas.tokens.placeables
                  .filter(a => a.id === combatant.tokenId)[0]
                const result = await this.update(token, "reduce", "loseMomentum")
                lostAdvantage += `${token.name}: ${result.starting} &rarr; ${result.new} <br/>`
              }
            }
            // Confirm changes made in whisper to GM
            if (lostAdvantage !== "") {
              const chatData = game.wfrp4e.utility.chatDataSetup(lostAdvantage, "gmroll", false)
              chatData.flavor = game.i18n.format("GMTOOLKIT.Message.Advantage.LostMomentum", { combatRound: round })
              ChatMessage.create(chatData, {})
            }
          }
        },
        {
          label: game.i18n.localize("GMTOOLKIT.Dialog.Cancel"),
          action: "cancel"
        }
      ]
    }
    )

    GMToolkit.log(false, "Lose Momentum at End of Round: Finished.")

  }

} // End Class



async function getOpposedLedger () {
  const combat = game.combats.active
  if (!combat) return {}
  return foundry.utils.deepClone(combat.getFlag(GMToolkit.MODULE_ID, "opposedLedger") ?? {})
}

async function setOpposedLedger (ledger) {
  const combat = game.combats.active
  if (!combat) return
  return combat.setFlag(GMToolkit.MODULE_ID, "opposedLedger", ledger)
}

function getActiveCombatantByActor (actorOrId) {
  const actorId = typeof actorOrId === "string" ? actorOrId : actorOrId?.id
  if (!actorId || !game.combats.active) return null
  return Array.from(game.combats.active.combatants).find(c => c.actor?.id === actorId) ?? null
}

function getTokenObjectForCombatant (combatant) {
  if (!combatant) return null
  return combatant.token?.object
    ?? canvas.tokens.placeables.find(t => t.id === combatant.tokenId)
    ?? null
}

function getOpposedMessageId (opposedTest, attackerTest, defenderTest) {
  const attackerMessageId =
    opposedTest?.attackerTest?.message?.id
    ?? attackerTest?.message?.id
    ?? "no-attacker-message"

  const defenderMessageId =
    opposedTest?.defenderTest?.message?.id
    ?? defenderTest?.message?.id
    ?? "no-defender-message"

  const attackerActorId =
    opposedTest?.attacker?.id
    ?? attackerTest?.actor?.id
    ?? "no-attacker-actor"

  const defenderActorId =
    opposedTest?.defender?.id
    ?? defenderTest?.actor?.id
    ?? "no-defender-actor"

  return `${attackerMessageId}__${defenderMessageId}__${attackerActorId}__${defenderActorId}`
}

async function reconcileOpposedTestAdvantage ({
  messageId,
  attackerActorId,
  defenderActorId,
  winnerSide,
  announce = true
}) {
  if (!game.user.isUniqueGM) return
  if (!messageId) return
  if (!["attacker", "defender"].includes(winnerSide)) return
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateOpposedTestAdvantage")) return

  const combat = game.combats.active
  if (!combat) return

  const attackerCombatant = getActiveCombatantByActor(attackerActorId)
  const defenderCombatant = getActiveCombatantByActor(defenderActorId)
  if (!attackerCombatant || !defenderCombatant) return

  const attackerToken = getTokenObjectForCombatant(attackerCombatant)
  const defenderToken = getTokenObjectForCombatant(defenderCombatant)
  if (!attackerToken || !defenderToken) return

  const ledger = await getOpposedLedger()
  const entry = ledger[messageId] ?? {
    attackerActorId,
    defenderActorId,
    lastWinnerSide: null,
    applied: null
  }

  entry.attackerActorId = attackerActorId
  entry.defenderActorId = defenderActorId

  // If same winner already synced, do nothing
  if (entry.applied && entry.lastWinnerSide === winnerSide) {
    GMToolkit.log(true, `Opposed ledger already synced for message ${messageId}.`)
    return
  }

  // Roll back previous effect of THIS opposed test only
  if (entry.applied) {
    const previousWinnerCombatant = getActiveCombatantByActor(entry.applied.winnerActorId)
    const previousLoserCombatant = getActiveCombatantByActor(entry.applied.loserActorId)

    const previousWinnerToken = getTokenObjectForCombatant(previousWinnerCombatant)
    const previousLoserToken = getTokenObjectForCombatant(previousLoserCombatant)

    if (previousWinnerToken && entry.applied.winnerDelta) {
      await Advantage.update(previousWinnerToken, -Math.abs(entry.applied.winnerDelta), "opposedLedger")
    }

    if (!game.settings.get("wfrp4e", "useGroupAdvantage") && previousLoserToken && entry.applied.loserDelta) {
      await Advantage.update(previousLoserToken, Math.abs(entry.applied.loserDelta), "opposedLedger")
    }
  }

  const winnerCombatant = winnerSide === "attacker" ? attackerCombatant : defenderCombatant
  const loserCombatant = winnerSide === "attacker" ? defenderCombatant : attackerCombatant

  const winnerToken = getTokenObjectForCombatant(winnerCombatant)
  const loserToken = getTokenObjectForCombatant(loserCombatant)
  if (!winnerToken || !loserToken) return

  let winnerDelta = 1
  if (
    game.settings.get("wfrp4e", "useGroupAdvantage") === true
    && winnerCombatant.actor?.id !== attackerActorId
  ) {
    winnerDelta = 0
    GMToolkit.log(true, "No advantage gained for winning an opposed test you did not initiate.")
  }

  const loserCurrent = !game.settings.get("wfrp4e", "useGroupAdvantage")
    ? Number(loserToken.actor.status.advantage.value ?? 0)
    : 0

  // Apply new final state
  if (loserCurrent > 0) {
    await Advantage.update(loserToken, -loserCurrent, "opposedLedger")
  }

  if (winnerDelta !== 0) {
    await Advantage.update(winnerToken, winnerDelta, "opposedLedger")
  }

  entry.lastWinnerSide = winnerSide
  entry.applied = {
    winnerActorId: winnerCombatant.actor.id,
    loserActorId: loserCombatant.actor.id,
    winnerDelta,
    loserDelta: loserCurrent
  }

  ledger[messageId] = entry
  await setOpposedLedger(ledger)

  if (announce && game.user.isGM) {
    const uiNotice = `${game.i18n.format("GMTOOLKIT.Advantage.Automation.OpposedTest", {
      winner: winnerCombatant.actor.name,
      loser: loserCombatant.actor.name
    })}`
    ui.notifications.notify(uiNotice, "success", {
      permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications"),
      console: true
    })
  }

  GMToolkit.log(true, "Advantage: Opposed Test reconciled.", { messageId, winnerSide, entry })
}


Hooks.on("wfrp4e:applyDamage", async function (scriptArgs) {
  GMToolkit.log(false, scriptArgs)
  if (!scriptArgs.opposedTest.defenderTest.context.unopposed) return // Only apply when Outmanouevring (ie, damage from an unopposed test).
  if (scriptArgs.opposedTest.attackerTest.preData.dualWielding) return // Exit if this is the first strike when Dual Wielding
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateDamageAdvantage")) return
  if (!inActiveCombat(scriptArgs.opposedTest.attackerTest.actor)
    | !inActiveCombat(scriptArgs.opposedTest.defenderTest.actor)) return // Exit if either actor is not in the active combat

  const uiNotice = `${game.i18n.format("GMTOOLKIT.Advantage.Automation.Outmanoeuvre", { actorName: scriptArgs.actor.name, attackerName: scriptArgs.attacker.name, totalWoundLoss: scriptArgs.totalWoundLoss } )}`
  const message = uiNotice
  const type = "success"
  const options = { permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications"), console: true }

  if (game.user.isGM) {ui.notifications.notify(message, type, options)}

  // Clear advantage on actor that has taken damage when not using Group  Advantage
  if (!game.settings.get("wfrp4e", "useGroupAdvantage")) {
    const character = Array.from(game.combats.active.combatants)
      .filter(c => c.actor === scriptArgs.actor)[0]
      .token.object
    await Advantage.update(character, "clear", "wfrp4e:applyDamage" )
  }

  // Increase advantage on actor that dealt damage, as long as it has not already been updated for this test
  const character = Array.from(game.combats.active.combatants)
    .filter(c => c.actor === scriptArgs.attacker)[0]
    .token.object
  if (character.combatant.getFlag(GMToolkit.MODULE_ID, "advantage")?.outmanoeuvre !== scriptArgs.opposedTest.attackerTest.message.id) {
    await Advantage.update(character, "increase", "wfrp4e:applyDamage")

    if (!character.actor.isOwner) {
      await game.socket.emit(`module.${GMToolkit.MODULE_ID}`, {
        type: "setFlag",
        payload: {
          character: character.combatant,
          updateData: {
            flag: "advantage",
            key: "outmanoeuvre",
            value: scriptArgs.opposedTest.attackerTest.message.id
          }
        }
      })
    } else {
      await character.combatant.setFlag(GMToolkit.MODULE_ID, "advantage", { outmanoeuvre: scriptArgs.opposedTest.attackerTest.message.id })
    }

  } else {
    GMToolkit.log(true, `Advantage increase already applied to ${character.name} for outmanoeuvring.`)
  }

  GMToolkit.log(false, "Outmanoeuvring Advantage: Finished.")
})


Hooks.on("wfrp4e:opposedTestResult", async function (opposedTest, attackerTest, defenderTest) {
  GMToolkit.log(true, "wfrp4e:opposedTestResult", opposedTest, attackerTest, defenderTest)

  // For Group Advantage, handle tests which should not generate advantage
  if (
    game.settings.get("wfrp4e", "useGroupAdvantage")
    && attackerTest.data?.result?.options?.preventAdvantage === true
  ) {
    GMToolkit.log(true, "No advantage gained for winning an opposed test that should not generate advantage.")
    return
  }

  // CHARGING: keep existing behavior
  if (!game.settings.get("wfrp4e", "useGroupAdvantage")) {
    // Flag attacker charging
    if (attackerTest.data.preData?.charging || attackerTest.data.result.other === game.i18n.localize("Charging")) {
      if (!attackerTest.actor.isOwner) {
        await game.socket.emit(`module.${GMToolkit.MODULE_ID}`, {
          type: "setFlag",
          payload: {
            character: Array.from(game.combats.active.combatants)
              .filter(c => c.actor === opposedTest.attacker)[0],
            updateData: {
              flag: "advantage",
              key: "charging",
              value: opposedTest.attackerTest.message.id
            }
          }
        })
      } else {
        await Array.from(game.combats.active.combatants)
          .filter(c => c.actor === opposedTest.attacker)[0]
          .setFlag(GMToolkit.MODULE_ID, "advantage", { charging: opposedTest.attackerTest.message.id })
      }
    }

    // Flag defender charging
    if (defenderTest.data.preData?.charging || defenderTest.data.result.other === game.i18n.localize("Charging")) {
      if (!defenderTest.actor.isOwner) {
        await game.socket.emit(`module.${GMToolkit.MODULE_ID}`, {
          type: "setFlag",
          payload: {
            character: Array.from(game.combats.active.combatants)
              .filter(c => c.actor === opposedTest.defender)[0],
            updateData: {
              flag: "advantage",
              key: "charging",
              value: opposedTest.attackerTest.message.id
            }
          }
        })
      } else {
        await Array.from(game.combats.active.combatants)
          .filter(c => c.actor === opposedTest.defender)[0]
          .setFlag(GMToolkit.MODULE_ID, "advantage", { charging: opposedTest.attackerTest.message.id })
      }
    }
  }

  // WINNING: reconcile the final state for this specific opposed test
  if (defenderTest.context.unopposed) return
  if (attackerTest.data.result.canDualWield) return
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateOpposedTestAdvantage")) return

  const attacker = attackerTest.actor
  const defender = defenderTest.actor
  if (!inActiveCombat(attacker) || !inActiveCombat(defender)) return

  const messageId = getOpposedMessageId(opposedTest, attackerTest, defenderTest)
  const winnerSide = opposedTest?.result?.winner

  await reconcileOpposedTestAdvantage({
    messageId,
    attackerActorId: attacker.id,
    defenderActorId: defender.id,
    winnerSide,
    announce: true
  })
})


// Intercept when an actor gets a condition during combat
Hooks.on("createActiveEffect", async function (conditionEffect) {
  GMToolkit.log(false, conditionEffect)
  // GUARDS. Exit if ...
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateConditionAdvantage")) return // ... not using condition automation
  if (game.settings.get("wfrp4e", "useGroupAdvantage")) return // ... Group Advantage is in play
  if (!game.user.isUniqueGM) return // ... not a GM
  if (!conditionEffect.parent.inCombat) return // ... not in combat
  if (!conditionEffect.isCondition) return  // ... not a system recognised condition
  const nonConditions = ["dead", "fear", "grappling", "engaged"]
  const condId = conditionEffect.conditionId
  if (nonConditions.includes(condId)) return // ... not a core rules combat condition

  // Clear Advantage
  const token = canvas.tokens.placeables.filter(
    t => conditionEffect.parent.id === (t?.actor?.id || t?.document?.id)
  )[0]
  await Advantage.update(token, "clear", "createActiveEffect")

  // Notification declarations
  const uiNotice = `${game.i18n.format("GMTOOLKIT.Advantage.Automation.Condition", { character: conditionEffect.parent.name, condition: conditionEffect.displayLabel } )}`
  const message = uiNotice
  const type = "info"
  const options = {
    permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications"),
    console: true
  }
  if (game.user.isGM) {ui.notifications.notify(message, type, options)}
})


Hooks.on("createCombatant", function (combatant) {
  // ADDING TO COMBAT: clear token Advantage only if enabled, and Group Advantage is not being used.
  // If Group Advantage is used, the system handles syncing individual advantage with the group
  if (game.user.isUniqueGM && game.settings.get(GMToolkit.MODULE_ID, "clearAdvantageCombatJoin") && !game.settings.get("wfrp4e", "useGroupAdvantage")) {
    const token = canvas.tokens.placeables
      .filter(a => a.id === combatant.tokenId)[0]
    Advantage.update(token, "clear", "createCombatant")
    Advantage.unsetFlags([combatant])
  }
})

Hooks.on("deleteCombatant", function (combatant) {
  if (game.user.isUniqueGM && game.settings.get(GMToolkit.MODULE_ID, "clearAdvantageCombatLeave")) {
    const token = canvas.tokens.placeables
      .filter(a => a.id === combatant.tokenId)[0]
    Advantage.update(token, "clear", "deleteCombatant")
  }
})


Hooks.on("preUpdateCombat", async function (combat, change) {
  if (!game.user.isUniqueGM || !combat.combatants.size || !change.round) return
  if ( !(change.round > combat.round) ) return // Exit if not advancing combat round, including going backwards through combat
  if (!combat.started) return // Exit when beginning combat; prevents loseMomentum firing prematurely

  // Lose Momentum: proceed only if enabled, and Group Advantage is not being used
  if (game.settings.get(GMToolkit.MODULE_ID, "promptMomentumLoss")
    && !game.settings.get("wfrp4e", "useGroupAdvantage")) {
    GMToolkit.log(false, "preUpdateCombat: compare Advantage at start and end of round")
    Advantage.loseMomentum(combat)
  }

})


Hooks.on("updateCombat", async function (combat, change) {
  if (!combat.round || !game.user.isUniqueGM || !combat.combatants.size) return
  if (!change.round) return // Exit if this isn't the start of a round

  // Clear Advantage flags when the combat round changes
  // Still required when Group Advantage is used because of Opposed Test flags
  GMToolkit.log(true, "updateCombat: unsetting Advantage flags")
  const advFlagged = combat.combatants.filter(c => c.getFlag(GMToolkit.MODULE_ID, "advantage"))
  if (advFlagged.length) await Advantage.unsetFlags(advFlagged)

  GMToolkit.log(false, "updateCombat: Setting startOfRound flag")
  // Skip individual start of round Advantage tracking if Group Advantage is being used
  if (combat.turns && combat.isActive && !game.settings.get("wfrp4e", "useGroupAdvantage")) {
    combat.combatants.forEach(async c => {
      await c.setFlag(GMToolkit.MODULE_ID, "sorAdvantage", c.token.actor.system.status.advantage.value)
      GMToolkit.log(false, `${c.name}:  ${c.getFlag(GMToolkit.MODULE_ID, "sorAdvantage")}`)
    })
  }
})


