// @ts-ignore
import chai, {should} from "chai";
// @ts-ignore
import chaiAsPromised from "chai-as-promised";

// @ts-ignore
import {deployments, ethers} from "hardhat";
import {
  advanceNSecondsAndBlock,
  getCurrentBlockTimestamp,
} from "../utils/TimeTravel";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import * as ethersTypes from "ethers";
import {toEther} from "../utils/helpers";
import {BigNumber} from "@ethersproject/bignumber";
import {
  createPool, getExactInput, getExactOutput, getExchangePath,
  uniswapQuoterAddress,
  uniswapRouterAddress,
} from "../utils/uniswap";

chai.use(chaiAsPromised);
should();

describe("Microcredit", () => {
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let maintainer1: SignerWithAddress;
  let maintainer2: SignerWithAddress;
  let manager1: SignerWithAddress;
  let manager2: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;

  let cUSD: ethersTypes.Contract;
  let mUSD: ethersTypes.Contract;
  let cTKN: ethersTypes.Contract;
  let Microcredit: ethersTypes.Contract;
  let MicrocreditRevenue: ethersTypes.Contract;
  let DonationMiner: ethersTypes.Contract;

  const oneMonth = 3600 * 24 * 30;
  const sixMonth = oneMonth * 6;

  const initialMicrocreditcUSDBalance = toEther(1000000);
  const initialUser1cUSDBalance = toEther(10000);
  const initialUser2cUSDBalance = toEther(20000);

  const initialMicrocreditmUSDBalance = toEther(2000000);
  const initialUser1mUSDBalance = toEther(30000);
  const initialUser2mUSDBalance = toEther(40000);

  const initialMicrocreditcTKNBalance = toEther(3000000);
  const initialUser1cTKNBalance = toEther(40000);
  const initialUser2cTKNBalance = toEther(50000);

  const MICROCREDIT_TOKEN_ADDRESS =
    "0x00000000000000000000000000000000000000C1";

  const DEFAULT_LENDER_ADDRESS = '0xE6662E970CD54c154af8b9dEd54C95a69b133A5a';
  const REWARD_MULTIPLIER = 10;

  const deploy = deployments.createFixture(async () => {
    await deployments.fixture("MicrocreditTest", {
      fallbackToGlobal: false,
    });

    [deployer, owner, maintainer1, maintainer2, manager1, manager2, user1, user2, user3, user4] =
      await ethers.getSigners();

    cUSD = await ethers.getContractAt(
      "TokenMock",
      (
        await deployments.get("TokenMock")
      ).address
    );

    const tokenFactory = await ethers.getContractFactory("TokenMock");
    mUSD = await tokenFactory.deploy("mUSD", "mUSD");
    cTKN = await tokenFactory.deploy("cTKN", "cTKN");

    Microcredit = await ethers.getContractAt(
      "MicrocreditImplementation",
      (
        await deployments.get("MicrocreditProxy")
      ).address
    );

    MicrocreditRevenue = await ethers.getContractAt(
      "MicrocreditRevenueImplementation",
      (
        await deployments.get("MicrocreditRevenueProxy")
      ).address
    );

    DonationMiner = await ethers.getContractAt(
      "DonationMinerImplementation",
      (
        await deployments.get("DonationMinerProxy")
      ).address
    );

    await cUSD.mint(Microcredit.address, initialMicrocreditcUSDBalance);
    await cUSD.mint(user1.address, initialUser1cUSDBalance);
    await cUSD.mint(user2.address, initialUser2cUSDBalance);

    await mUSD.mint(Microcredit.address, initialMicrocreditmUSDBalance);
    await mUSD.mint(user1.address, initialUser1mUSDBalance);
    await mUSD.mint(user2.address, initialUser2mUSDBalance);

    await cTKN.mint(Microcredit.address, initialMicrocreditcTKNBalance);
    await cTKN.mint(user1.address, initialUser1cTKNBalance);
    await cTKN.mint(user2.address, initialUser2cTKNBalance);


    await Microcredit.connect(owner).updateUniswapQuoter(uniswapQuoterAddress)
    await Microcredit.connect(owner).updateUniswapRouter(uniswapRouterAddress)

    await createPools();
  });

  function getDebtOnDayX(
    amount: BigNumber,
    dailyInterest: BigNumber,
    nrOfDays: number
  ): BigNumber {
    while (nrOfDays >= 0) {
      amount = amount.add(
        amount.mul(dailyInterest).div(100).div(toEther(1))
      );
      nrOfDays--;
    }
    return amount;
  }

  async function createPools() {
    await cUSD.mint(owner.address, toEther(1000000000));
    await mUSD.mint(owner.address, toEther(1000000000));
    await cTKN.mint(owner.address, toEther(1000000000));

    await createPool(
      owner,
      cUSD,
      mUSD,
      toEther(1000000),
      toEther(1000000)
    );

    await createPool(
      owner,
      cUSD,
      cTKN,
      toEther(500000),
      toEther(1000000)
    )
  }

  describe("Microcredit - basic", () => {
    before(async function () {
    });

    beforeEach(async () => {
      await deploy();
    });

    it("should have correct values", async function () {
      (await Microcredit.owner()).should.eq(owner.address);
      (await Microcredit.getVersion()).should.eq(2);
      (await Microcredit.cUSD()).should.eq(cUSD.address);
      (await Microcredit.revenueAddress()).should.eq(
        MicrocreditRevenue.address
      );
      (await Microcredit.donationMiner()).should.eq(
        DonationMiner.address
      );

      await Microcredit.callStatic.userLoans(
        user1.address,
        0
      ).should.be.rejectedWith("Microcredit: Invalid wallet address");
    });

    it("Should update revenueAddress if owner", async function () {
      (await Microcredit.revenueAddress()).should.eq(
        MicrocreditRevenue.address
      );
      await Microcredit.connect(owner).updateRevenueAddress(user1.address)
        .should.be.fulfilled;
      (await Microcredit.revenueAddress()).should.eq(user1.address);
    });

    it("Should not update revenueAddress if not owner", async function () {
      await Microcredit.connect(user1)
        .updateRevenueAddress(user1.address)
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should update donationMiner if owner", async function () {
      (await Microcredit.donationMiner()).should.eq(
        DonationMiner.address
      );
      await Microcredit.connect(owner).updateDonationMiner(user1.address)
        .should.be.fulfilled;
      (await Microcredit.donationMiner()).should.eq(user1.address);
    });

    it("Should not update DonationMiner if not owner", async function () {
      await Microcredit.connect(user1)
        .updateDonationMiner(user1.address)
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should update uniswapRouter if owner", async function () {
      (await Microcredit.uniswapRouter()).should.eq(
        uniswapRouterAddress
      );
      await Microcredit.connect(owner).updateUniswapRouter(user1.address)
        .should.be.fulfilled;
      (await Microcredit.uniswapRouter()).should.eq(user1.address);
    });

    it("Should not update uniswapRouter if not owner", async function () {
      await Microcredit.connect(user1)
        .updateUniswapRouter(user1.address)
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should update uniswapQuoter if owner", async function () {
      (await Microcredit.uniswapQuoter()).should.eq(
        uniswapQuoterAddress
      );
      await Microcredit.connect(owner).updateUniswapQuoter(user1.address)
        .should.be.fulfilled;
      (await Microcredit.uniswapQuoter()).should.eq(user1.address);
    });

    it("Should not update uniswapQuoter if not owner", async function () {
      await Microcredit.connect(user1)
        .updateUniswapQuoter(user1.address)
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should addToken if owner", async function () {
      (await Microcredit.tokenListLength()).should.eq(0);
      (await Microcredit.tokens(cUSD.address)).should.eq(false);

      await Microcredit.connect(owner)
        .addToken(cUSD.address, [], [])
        .should.emit(Microcredit, "TokenAdded")
        .withArgs(cUSD.address);

      (await Microcredit.tokenListLength()).should.eq(1);
      (await Microcredit.tokenListAt(0)).should.eq(cUSD.address);
      (await Microcredit.tokens(cUSD.address)).should.eq(true);
    });

    it("Should addToken multiple times if owner", async function () {
      (await Microcredit.tokenListLength()).should.eq(0);
      (await Microcredit.tokens(cUSD.address)).should.eq(false);
      (await Microcredit.tokens(mUSD.address)).should.eq(false);
      (await Microcredit.tokens(cTKN.address)).should.eq(false);

      await Microcredit.connect(owner)
        .addToken(cUSD.address, [], [])
        .should.emit(Microcredit, "TokenAdded")
        .withArgs(cUSD.address);

      await Microcredit.connect(owner)
        .addToken(mUSD.address, [cUSD.address], [10000])
        .should.emit(Microcredit, "TokenAdded")
        .withArgs(mUSD.address);

      await Microcredit.connect(owner)
        .addToken(cTKN.address, [cUSD.address], [10000])
        .should.emit(Microcredit, "TokenAdded")
        .withArgs(cTKN.address);

      (await Microcredit.tokenListLength()).should.eq(3);
      (await Microcredit.tokenListAt(0)).should.eq(cUSD.address);
      (await Microcredit.tokenListAt(1)).should.eq(mUSD.address);
      (await Microcredit.tokenListAt(2)).should.eq(cTKN.address);
      (await Microcredit.tokens(cUSD.address)).should.eq(true);
      (await Microcredit.tokens(mUSD.address)).should.eq(true);
      (await Microcredit.tokens(cTKN.address)).should.eq(true);
    });

    it("Should not addToken if not owner", async function () {
      await Microcredit.connect(user1)
        .addToken(cUSD.address, [], [])
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should inactivateToken if owner", async function () {
      await Microcredit.connect(owner).addToken(cUSD.address, [], []);
      await Microcredit.connect(owner).addToken(mUSD.address, [cUSD.address], [10000]);
      await Microcredit.connect(owner).addToken(cTKN.address, [cUSD.address], [10000]);

      (await Microcredit.tokenListLength()).should.eq(3);
      (await Microcredit.tokenListAt(0)).should.eq(cUSD.address);
      (await Microcredit.tokenListAt(1)).should.eq(mUSD.address);
      (await Microcredit.tokenListAt(2)).should.eq(cTKN.address);
      (await Microcredit.tokens(cUSD.address)).should.eq(true);
      (await Microcredit.tokens(mUSD.address)).should.eq(true);
      (await Microcredit.tokens(cTKN.address)).should.eq(true);

      await Microcredit.connect(owner)
        .inactivateToken(mUSD.address)
        .should.emit(Microcredit, "TokenRemoved")
        .withArgs(mUSD.address);

      (await Microcredit.tokenListLength()).should.eq(3);
      (await Microcredit.tokenListAt(0)).should.eq(cUSD.address);
      (await Microcredit.tokenListAt(1)).should.eq(mUSD.address);
      (await Microcredit.tokenListAt(2)).should.eq(cTKN.address);
      (await Microcredit.tokens(cUSD.address)).should.eq(true);
      (await Microcredit.tokens(mUSD.address)).should.eq(false);
      (await Microcredit.tokens(cTKN.address)).should.eq(true);
    });

    it("Should not addToken if not owner", async function () {
      await Microcredit.connect(user1)
        .inactivateToken(cUSD.address)
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should not inactivateToken if token is inactive", async function () {
      await Microcredit.connect(owner)
        .inactivateToken(cUSD.address)
        .should.be.rejectedWith("Microcredit: Token is not active");
    });

    it("Should transferERC20 to address if owner", async function () {
      const initialUserBalance = await cUSD.balanceOf(user1.address);
      await Microcredit.connect(owner).transferERC20(
        cUSD.address,
        user1.address,
        toEther("100")
      ).should.be.fulfilled;
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(toEther(100))
      );
      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUserBalance.add(toEther("100"))
      );
    });

    it("Should not transferERC20 if not owner", async function () {
      await Microcredit.connect(deployer)
        .transferERC20(cUSD.address, user1.address, toEther("100"))
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });
  });

  describe("Microcredit - maintainer", () => {
    before(async function () {
    });

    beforeEach(async () => {
      await deploy();
    });

    it("Should not addMaintainers if not owner", async function () {
      await Microcredit.connect(user1)
        .addMaintainers(
          [maintainer1.address]
        )
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should addMaintainers if owner (one maintainer)", async function () {
      (await Microcredit.maintainerListLength()).should.eq(0);
      await Microcredit.connect(owner)
        .addMaintainers(
          [maintainer1.address]
        )
        .should.emit(Microcredit, "MaintainerAdded")
        .withArgs(maintainer1.address);

      (await Microcredit.maintainerListLength()).should.eq(1);
      (await Microcredit.maintainerListAt(0)).should.eq(maintainer1.address);
    });

    it("Should addMaintainers (multiple maintainers)", async function () {
      (await Microcredit.maintainerListLength()).should.eq(0);
      await Microcredit.connect(owner)
        .addMaintainers(
          [maintainer1.address, maintainer2.address]
        )
        .should.emit(Microcredit, "MaintainerAdded")
        .withArgs(maintainer1.address)
        .emit(Microcredit, "MaintainerAdded")
        .withArgs(maintainer2.address);

      (await Microcredit.maintainerListLength()).should.eq(2);
      (await Microcredit.maintainerListAt(0)).should.eq(maintainer1.address);
      (await Microcredit.maintainerListAt(1)).should.eq(maintainer2.address);
    });

    it("Should removeMaintainers if owner", async function () {
      await Microcredit.connect(owner).addMaintainers(
        [maintainer1.address, maintainer2.address]
      );

      await Microcredit.connect(owner)
        .removeMaintainers([maintainer1.address])
        .should.emit(Microcredit, "MaintainerRemoved")
        .withArgs(maintainer1.address);

      (await Microcredit.maintainerListLength()).should.eq(1);
    });

    it("Should not removeMaintainers if not owner", async function () {
      await Microcredit.connect(user1)
        .removeMaintainers([maintainer1.address])
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });
  });


  describe("Microcredit - managers", () => {
    before(async function () {
    });

    beforeEach(async () => {
      await deploy();

      await Microcredit.connect(owner).addToken(cUSD.address, [], []);

      await Microcredit.connect(owner).addMaintainers(
        [maintainer1.address, maintainer2.address]
      );
    });

    it("Should not addManagers if not owner nor maintainer", async function () {
      await Microcredit.connect(user1)
        .addManagers(
          [manager1.address],
          [toEther(1000)]
        )
        .should.be.rejectedWith("Microcredit: caller is not a maintainer");
    });

    it("Should addManagers if owner (one manager)", async function () {
      (await Microcredit.managerListLength()).should.eq(0);
      await Microcredit.connect(owner)
        .addManagers(
          [manager1.address],
          [toEther(1000)]
        )
        .should.emit(Microcredit, "ManagerAdded")
        .withArgs(manager1.address, toEther(1000));

      (await Microcredit.managerListLength()).should.eq(1);
      (await Microcredit.managerListAt(0)).should.eq(manager1.address);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(toEther(1000));
      manager1Info.lentAmount.should.eq(toEther(0));
    });

    it("Should addManagers if maintainer #1", async function () {
      (await Microcredit.managerListLength()).should.eq(0);
      await Microcredit.connect(maintainer1)
        .addManagers(
          [manager1.address],
          [toEther(1000)]
        )
        .should.emit(Microcredit, "ManagerAdded")
        .withArgs(manager1.address, toEther(1000));

      (await Microcredit.managerListLength()).should.eq(1);
      (await Microcredit.managerListAt(0)).should.eq(manager1.address);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(toEther(1000));
      manager1Info.lentAmount.should.eq(toEther(0));
    });

    it("Should addManagers if maintainer #2", async function () {
      (await Microcredit.managerListLength()).should.eq(0);
      await Microcredit.connect(maintainer2)
        .addManagers(
          [manager1.address],
          [toEther(1000)]
        )
        .should.emit(Microcredit, "ManagerAdded")
        .withArgs(manager1.address, toEther(1000));

      (await Microcredit.managerListLength()).should.eq(1);
      (await Microcredit.managerListAt(0)).should.eq(manager1.address);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(toEther(1000));
      manager1Info.lentAmount.should.eq(toEther(0));
    });

    it("Should addManagers (multiple managers, same token)", async function () {
      (await Microcredit.managerListLength()).should.eq(0);
      await Microcredit.connect(owner)
        .addManagers(
          [manager1.address, manager2.address],
          [toEther(1000), toEther(2000)]
        )
        .should.emit(Microcredit, "ManagerAdded")
        .withArgs(manager1.address, toEther(1000))
        .emit(Microcredit, "ManagerAdded")
        .withArgs(manager2.address, toEther(2000));

      (await Microcredit.managerListLength()).should.eq(2);
      (await Microcredit.managerListAt(0)).should.eq(manager1.address);
      (await Microcredit.managerListAt(1)).should.eq(manager2.address);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(toEther(1000));
      manager1Info.lentAmount.should.eq(toEther(0));
    });

    it("Should addManagers (multiple managers, multiple tokens)", async function () {
      (await Microcredit.managerListLength()).should.eq(0);
      await Microcredit.connect(owner)
        .addManagers(
          [manager1.address, manager2.address],
          [toEther(1000), toEther(2000)]
        )
        .should.emit(Microcredit, "ManagerAdded")
        .withArgs(manager1.address, toEther(1000))
        .emit(Microcredit, "ManagerAdded")
        .withArgs(manager2.address, toEther(2000));

      (await Microcredit.managerListLength()).should.eq(2);
      (await Microcredit.managerListAt(0)).should.eq(manager1.address);
      (await Microcredit.managerListAt(1)).should.eq(manager2.address);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(toEther(1000));
      manager1Info.lentAmount.should.eq(toEther(0));
    });

    it("Should override manager limit", async function () {
      (await Microcredit.managerListLength()).should.eq(0);

      await Microcredit.connect(owner)
        .addManagers(
          [manager1.address, manager2.address],
          [toEther(1000), toEther(2000)]
        )
        .should.emit(Microcredit, "ManagerAdded")
        .withArgs(manager1.address, toEther(1000))
        .emit(Microcredit, "ManagerAdded")
        .withArgs(manager2.address, toEther(2000));

      (await Microcredit.managerListLength()).should.eq(2);
      (await Microcredit.managerListAt(0)).should.eq(manager1.address);
      (await Microcredit.managerListAt(1)).should.eq(manager2.address);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(toEther(1000));
      manager1Info.lentAmount.should.eq(toEther(0));


      const manager2Info = await Microcredit.managers(manager2.address);
      manager2Info.lentAmountLimit.should.eq(toEther(2000));
      manager2Info.lentAmount.should.eq(toEther(0));

      await Microcredit.connect(owner)
        .addManagers([manager1.address], [toEther(500)])
        .should.emit(Microcredit, "ManagerAdded")
        .withArgs(manager1.address, toEther(500));

      const manager1InfoAfter = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter.lentAmountLimit.should.eq(toEther(500));
      manager1InfoAfter.lentAmount.should.eq(toEther(0));
    });

    it("Should removeManagers if owner", async function () {
      await Microcredit.connect(owner).addManagers(
        [manager1.address, manager1.address],
        [toEther(1000), toEther(3000)]
      );

      await Microcredit.connect(owner)
        .removeManagers([manager1.address])
        .should.emit(Microcredit, "ManagerRemoved")
        .withArgs(manager1.address);

      (await Microcredit.managerListLength()).should.eq(0);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(toEther(0));
      manager1Info.lentAmount.should.eq(toEther(0));
    });

    it("Should not removeManagers if not owner", async function () {
      await Microcredit.connect(user1)
        .removeManagers([manager1.address])
        .should.be.rejectedWith("Microcredit: caller is not a maintainer");
    });
  });

  describe("Microcredit - loan functionalities (revenue address = Microcredit)", () => {
    before(async function () {
    });

    const manager1LentAmountLimit = toEther(1000);
    const manager2LentAmountLimit = toEther(3000);

    beforeEach(async () => {
      await deploy();

      await Microcredit.connect(owner).updateRevenueAddress(
        Microcredit.address
      );

      await Microcredit.connect(owner).addToken(cUSD.address, [], []);
      await Microcredit.connect(owner).addToken(mUSD.address, [cUSD.address], [10000]);

      await Microcredit.connect(owner).addManagers(
        [manager1.address, manager2.address, manager1.address],
        [
          manager1LentAmountLimit,
          manager2LentAmountLimit,
          manager1LentAmountLimit,
        ]
      );

      await Microcredit.connect(owner).addMaintainers([maintainer1.address, maintainer2.address])
    });

    it("Should not addLoan if not manager", async function () {
      await Microcredit.connect(user1)
        .addLoan(
          user1.address,
          cUSD.address,
          toEther(100),
          sixMonth,
          toEther(0.2),
          2000000000
        )
        .should.be.rejectedWith("Microcredit: caller is not a manager");
    });

    it("Should not addLoan if claimDeadline in the past", async function () {
      const claimDeadline = (await getCurrentBlockTimestamp()) - 1;
      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          toEther(100),
          sixMonth,
          toEther(0.2),
          claimDeadline
        )
        .should.be.rejectedWith("Microcredit: invalid claimDeadline");
    });

    it("Should not addLoan if invalid token", async function () {
      const claimDeadline = (await getCurrentBlockTimestamp()) - 1;
      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cTKN.address,
          toEther(100),
          sixMonth,
          toEther(0.2),
          claimDeadline
        )
        .should.be.rejectedWith("Microcredit: invalid token");
    });

    it("should addLoan if manager", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      let walletMetadata = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata.userId.should.eq(0);
      walletMetadata.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata.loansLength.should.eq(0);

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount,
          period,
          dailyInterest,
          claimDeadline
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount,
          period,
          dailyInterest,
          claimDeadline
        );

      walletMetadata = await Microcredit.walletMetadata(user1.address);
      walletMetadata.userId.should.eq(1);
      walletMetadata.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(0);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(0);
      loan.managerAddress.should.eq(manager1.address);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount);
    });

    it("Should not addLoan if the user has been moved", async function () {
      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        toEther(100),
        sixMonth,
        toEther(0.2),
        2000000000
      );

      await Microcredit.connect(maintainer1).changeUserAddress(
        user1.address,
        user2.address
      );

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          toEther(100),
          sixMonth,
          toEther(0.2),
          2000000000
        )
        .should.be.rejectedWith("Microcredit: The user has been moved");
    });

    it("should not addLoan for a user with an active loan", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        );
      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        )
        .should.be.rejectedWith(
          "Microcredit: The user already has an active loan"
        );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);

      let loan1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan1.tokenAddress.should.eq(cUSD.address);
      loan1.amountBorrowed.should.eq(amount1);
      loan1.period.should.eq(period1);
      loan1.dailyInterest.should.eq(dailyInterest1);
      loan1.claimDeadline.should.eq(claimDeadline1);
      loan1.startDate.should.eq(0);
      loan1.lastComputedDebt.should.eq(0);
      loan1.currentDebt.should.eq(0);
      loan1.amountRepayed.should.eq(0);
      loan1.repaymentsLength.should.eq(0);
      loan1.lastComputedDate.should.eq(0);
      loan1.tokenAmountBorrowed.should.eq(loan1.amountBorrowed);
      loan1.tokenAmountRepayed.should.eq(loan1.amountRepayed);
      loan1.tokenLastComputedDebt.should.eq(loan1.lastComputedDebt);
      loan1.tokenCurrentDebt.should.eq(loan1.currentDebt);

      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
      );
    });

    it("should not addLoan if manager don't have enough funds #1", async function () {
      const amount1 = manager1LentAmountLimit.add(1);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .should.be.rejectedWith(
          "Microcredit: Manager don't have enough funds to borrow this amount"
        );
    });

    it("should not addLoan if manager don't have enough funds #2", async function () {
      const amount1 = manager1LentAmountLimit;
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(1);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        );

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount1);

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        )
        .should.be.rejectedWith(
          "Microcredit: Manager don't have enough funds to borrow this amount"
        );
    });

    it("should addLoan after fully paid previous loan", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 1000;

      const expectedDebt1 = getDebtOnDayX(amount1, dailyInterest1, 0);

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        );

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount1);

      await Microcredit.connect(user1).claimLoan(0);
      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedDebt1);

      await Microcredit.connect(user1).repayLoan(0, expectedDebt1);

      const manager1InfoAfter = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1InfoAfter.lentAmount.should.eq(0);

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          1,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(2);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);

      let loan1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan1.tokenAddress.should.eq(cUSD.address);
      loan1.amountBorrowed.should.eq(amount1);
      loan1.period.should.eq(period1);
      loan1.dailyInterest.should.eq(dailyInterest1);
      loan1.claimDeadline.should.eq(claimDeadline1);

      let loan2 = await Microcredit.callStatic.userLoans(user1.address, 1);
      loan2.tokenAddress.should.eq(cUSD.address);
      loan2.amountBorrowed.should.eq(amount2);
      loan2.period.should.eq(period2);
      loan2.dailyInterest.should.eq(dailyInterest2);
      loan2.claimDeadline.should.eq(claimDeadline2);
      loan2.startDate.should.eq(0);
      loan2.lastComputedDebt.should.eq(0);
      loan2.currentDebt.should.eq(0);
      loan2.amountRepayed.should.eq(0);
      loan2.repaymentsLength.should.eq(0);
      loan2.lastComputedDate.should.eq(0);
      loan2.tokenAmountBorrowed.should.eq(loan2.amountBorrowed);
      loan2.tokenAmountRepayed.should.eq(loan2.amountRepayed);
      loan2.tokenLastComputedDebt.should.eq(loan2.lastComputedDebt);
      loan2.tokenCurrentDebt.should.eq(loan2.currentDebt);

      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.add(expectedDebt1.sub(amount1))
      );

      const manager1InfoAfter2 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter2.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1InfoAfter2.lentAmount.should.eq(amount2);
    });

    it("should not addLoan if previous loan hasn't been claimed", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 3000;

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        );

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        )
        .should.be.rejectedWith(
          "Microcredit: The user already has an active loan"
        );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);
    });

    it("should not addLoan if previous loan has been claimed", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 3000;

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        );

      await Microcredit.connect(user1).claimLoan(0);
      await cUSD
        .connect(user1)
        .approve(Microcredit.address, amount1.div(2));

      await Microcredit.connect(user1).repayLoan(0, amount1.div(2));

      await advanceNSecondsAndBlock(2000);

      await Microcredit.connect(manager1)
        .addLoan(
          user1.address,
          cUSD.address,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        )
        .should.be.rejectedWith(
          "Microcredit: The user already has an active loan"
        );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);
    });

    it("should addLoan for multiple users", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount1,
        period1,
        dailyInterest1,
        claimDeadline1
      ).should.be.fulfilled;

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount1);

      await Microcredit.connect(manager1).addLoan(
        user2.address,
        cUSD.address,
        amount2,
        period2,
        dailyInterest2,
        claimDeadline2
      ).should.be.fulfilled;

      const manager1InfoAfter = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1InfoAfter.lentAmount.should.eq(
        amount1.add(amount2)
      );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(1);

      let walletMetadata2 = await Microcredit.walletMetadata(
        user2.address
      );
      walletMetadata2.userId.should.eq(2);
      walletMetadata2.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata2.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(2);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);
      (await Microcredit.walletListAt(1)).should.eq(user2.address);

      let loan1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan1.tokenAddress.should.eq(cUSD.address);
      loan1.amountBorrowed.should.eq(amount1);
      loan1.period.should.eq(period1);
      loan1.dailyInterest.should.eq(dailyInterest1);
      loan1.claimDeadline.should.eq(claimDeadline1);
      loan1.startDate.should.eq(0);
      loan1.lastComputedDebt.should.eq(0);
      loan1.currentDebt.should.eq(0);
      loan1.amountRepayed.should.eq(0);
      loan1.repaymentsLength.should.eq(0);
      loan1.lastComputedDate.should.eq(0);
      loan1.tokenAmountBorrowed.should.eq(loan1.amountBorrowed);
      loan1.tokenAmountRepayed.should.eq(loan1.amountRepayed);
      loan1.tokenLastComputedDebt.should.eq(loan1.lastComputedDebt);
      loan1.tokenCurrentDebt.should.eq(loan1.currentDebt);

      let loan2 = await Microcredit.callStatic.userLoans(user2.address, 0);
      loan2.tokenAddress.should.eq(cUSD.address);
      loan2.amountBorrowed.should.eq(amount2);
      loan2.period.should.eq(period2);
      loan2.dailyInterest.should.eq(dailyInterest2);
      loan2.claimDeadline.should.eq(claimDeadline2);
      loan2.startDate.should.eq(0);
      loan2.lastComputedDebt.should.eq(0);
      loan2.currentDebt.should.eq(0);
      loan2.amountRepayed.should.eq(0);
      loan2.repaymentsLength.should.eq(0);
      loan2.lastComputedDate.should.eq(0);
      loan2.tokenAmountBorrowed.should.eq(loan2.amountBorrowed);
      loan2.tokenAmountRepayed.should.eq(loan2.amountRepayed);
      loan2.tokenLastComputedDebt.should.eq(loan2.lastComputedDebt);
      loan2.tokenCurrentDebt.should.eq(loan2.currentDebt);
    });

    it("Should not addLoans if not manager", async function () {
      await Microcredit.connect(user1)
        .addLoans(
          [user1.address],
          [cUSD.address],
          [toEther(100)],
          [sixMonth],
          [toEther(0.2)],
          [2000000000]
        )
        .should.be.rejectedWith("Microcredit: caller is not a manager");
    });

    it("should addLoans if manager #2", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      let walletMetadata = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata.userId.should.eq(0);
      walletMetadata.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata.loansLength.should.eq(0);

      await Microcredit.connect(manager2)
        .addLoans(
          [user1.address],
          [cUSD.address],
          [amount],
          [period],
          [dailyInterest],
          [claimDeadline]
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount,
          period,
          dailyInterest,
          claimDeadline
        );

      walletMetadata = await Microcredit.walletMetadata(user1.address);
      walletMetadata.userId.should.eq(1);
      walletMetadata.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.startDate.should.eq(0);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(0);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      const manager2Info = await Microcredit.managers(manager2.address);
      manager2Info.lentAmountLimit.should.eq(
        manager2LentAmountLimit
      );
      manager2Info.lentAmount.should.eq(amount);
    });

    it("should not addLoans twice for same user", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1)
        .addLoans(
          [user1.address, user1.address],
          [cUSD.address, cUSD.address],
          [amount1, amount2],
          [period1, period2],
          [dailyInterest1, dailyInterest2],
          [claimDeadline1, claimDeadline2]
        )
        .should.be.rejectedWith(
          "Microcredit: The user already has an active loan"
        );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(0);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(0);
    });

    it("should addLoans for multiple users (same token)", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 2000;

      await Microcredit.connect(manager1)
        .addLoans(
          [user1.address, user2.address],
          [cUSD.address, cUSD.address],
          [amount1, amount2],
          [period1, period2],
          [dailyInterest1, dailyInterest2],
          [claimDeadline1, claimDeadline2]
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .emit(Microcredit, "LoanAdded")
        .withArgs(
          user2.address,
          cUSD.address,
          0,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(1);

      let walletMetadata2 = await Microcredit.walletMetadata(
        user2.address
      );
      walletMetadata2.userId.should.eq(2);
      walletMetadata2.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata2.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(2);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);
      (await Microcredit.walletListAt(1)).should.eq(user2.address);

      let loan1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan1.tokenAddress.should.eq(cUSD.address);
      loan1.amountBorrowed.should.eq(amount1);
      loan1.period.should.eq(period1);
      loan1.dailyInterest.should.eq(dailyInterest1);
      loan1.claimDeadline.should.eq(claimDeadline1);
      loan1.startDate.should.eq(0);
      loan1.lastComputedDebt.should.eq(0);
      loan1.currentDebt.should.eq(0);
      loan1.amountRepayed.should.eq(0);
      loan1.repaymentsLength.should.eq(0);
      loan1.lastComputedDate.should.eq(0);
      loan1.tokenAmountBorrowed.should.eq(loan1.amountBorrowed);
      loan1.tokenAmountRepayed.should.eq(loan1.amountRepayed);
      loan1.tokenLastComputedDebt.should.eq(loan1.lastComputedDebt);
      loan1.tokenCurrentDebt.should.eq(loan1.currentDebt);

      let loan2 = await Microcredit.callStatic.userLoans(user2.address, 0);
      loan2.tokenAddress.should.eq(cUSD.address);
      loan2.amountBorrowed.should.eq(amount2);
      loan2.period.should.eq(period2);
      loan2.dailyInterest.should.eq(dailyInterest2);
      loan2.claimDeadline.should.eq(claimDeadline2);
      loan2.startDate.should.eq(0);
      loan2.lastComputedDebt.should.eq(0);
      loan2.currentDebt.should.eq(0);
      loan2.amountRepayed.should.eq(0);
      loan2.repaymentsLength.should.eq(0);
      loan2.lastComputedDate.should.eq(0);
      loan2.tokenAmountBorrowed.should.eq(loan2.amountBorrowed);
      loan2.tokenAmountRepayed.should.eq(loan2.amountRepayed);
      loan2.tokenLastComputedDebt.should.eq(loan2.lastComputedDebt);
      loan2.tokenCurrentDebt.should.eq(loan2.currentDebt);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount1.add(amount2));
    });

    it("should addLoans for multiple users (multiple tokens)", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 2000;

      await Microcredit.connect(manager1)
        .addLoans(
          [user1.address, user2.address],
          [cUSD.address, mUSD.address],
          [amount1, amount2],
          [period1, period2],
          [dailyInterest1, dailyInterest2],
          [claimDeadline1, claimDeadline2]
        )
        .should.emit(Microcredit, "LoanAdded")
        .withArgs(
          user1.address,
          cUSD.address,
          0,
          amount1,
          period1,
          dailyInterest1,
          claimDeadline1
        )
        .emit(Microcredit, "LoanAdded")
        .withArgs(
          user2.address,
          mUSD.address,
          0,
          amount2,
          period2,
          dailyInterest2,
          claimDeadline2
        );

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata1.loansLength.should.eq(1);

      let walletMetadata2 = await Microcredit.walletMetadata(
        user2.address
      );
      walletMetadata2.userId.should.eq(2);
      walletMetadata2.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata2.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(2);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);
      (await Microcredit.walletListAt(1)).should.eq(user2.address);

      let loan1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan1.tokenAddress.should.eq(cUSD.address);
      loan1.amountBorrowed.should.eq(amount1);
      loan1.period.should.eq(period1);
      loan1.dailyInterest.should.eq(dailyInterest1);
      loan1.claimDeadline.should.eq(claimDeadline1);
      loan1.startDate.should.eq(0);
      loan1.lastComputedDebt.should.eq(0);
      loan1.currentDebt.should.eq(0);
      loan1.amountRepayed.should.eq(0);
      loan1.repaymentsLength.should.eq(0);
      loan1.lastComputedDate.should.eq(0);
      loan1.tokenAmountBorrowed.should.eq(loan1.amountBorrowed);
      loan1.tokenAmountRepayed.should.eq(0);
      loan1.tokenLastComputedDebt.should.eq(0);
      loan1.tokenCurrentDebt.should.eq(0);

      let loan2 = await Microcredit.callStatic.userLoans(user2.address, 0);
      loan2.amountBorrowed.should.eq(amount2);
      loan2.period.should.eq(period2);
      loan2.dailyInterest.should.eq(dailyInterest2);
      loan2.claimDeadline.should.eq(claimDeadline2);
      loan2.startDate.should.eq(0);
      loan2.lastComputedDebt.should.eq(0);
      loan2.currentDebt.should.eq(0);
      loan2.amountRepayed.should.eq(0);
      loan2.repaymentsLength.should.eq(0);
      loan2.lastComputedDate.should.eq(0);
      loan2.tokenAmountBorrowed.should.eq(await getExactOutput(cUSD, mUSD, loan2.amountBorrowed));
      loan2.tokenAmountRepayed.should.eq(0);
      loan2.tokenLastComputedDebt.should.eq(0);
      loan2.tokenCurrentDebt.should.eq(0);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount1.add(amount2));
    });

    it("should not editLoanClaimDeadlines is not Manager", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 2000;

      await Microcredit.connect(manager1)
        .addLoans(
          [user1.address, user2.address],
          [cUSD.address, mUSD.address],
          [amount1, amount2],
          [period1, period2],
          [dailyInterest1, dailyInterest2],
          [claimDeadline1, claimDeadline2]
        ).should.fulfilled;

      await Microcredit.connect(user1)
        .editLoanClaimDeadlines(
          [user1.address],
          [0],
          [(await getCurrentBlockTimestamp()) + 1001]
        ).should.be.rejectedWith('Microcredit: caller is not a manager');
    });


    it("should editLoanClaimDeadlines is manager", async function () {
      const amount1 = toEther(100);
      const period1 = sixMonth;
      const dailyInterest1 = toEther(0.2);
      const claimDeadline1 = (await getCurrentBlockTimestamp()) + 1000;

      const amount2 = toEther(200);
      const period2 = oneMonth;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 2000;

      await Microcredit.connect(manager1)
        .addLoans(
          [user1.address, user2.address],
          [cUSD.address, mUSD.address],
          [amount1, amount2],
          [period1, period2],
          [dailyInterest1, dailyInterest2],
          [claimDeadline1, claimDeadline2]
        ).should.fulfilled;

      await Microcredit.connect(manager1)
        .editLoanClaimDeadlines(
          [user1.address, user2.address],
          [0, 0],
          [claimDeadline1 + 100, claimDeadline2 + 200]
        ).should.emit(Microcredit, "LoanEdited")
        .withArgs(user1.address, 0, period1, claimDeadline1 + 100, dailyInterest1, 0, 0)
        .withArgs(user2.address, 0, period2, claimDeadline2 + 200, dailyInterest2, 0, 0);

    });

    it("should claimLoan #1", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1)
        .claimLoan(0)
        .should.emit(Microcredit, "LoanClaimed")
        .withArgs(user1.address, 0);

      const statDate = await getCurrentBlockTimestamp();

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 0));
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(statDate);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(amount)
      );
    });

    it("should claimLoan #2", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user2.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 0));
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount.add(amount));

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(amount)
      );
    });

    it("should claimLoan #3", async function () {
      const amount1 = toEther(100);
      const amount2 = toEther(200);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount1,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(manager1).addLoan(
        user2.address,
        mUSD.address,
        amount2,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const tokenAmount2 = await getExactOutput(mUSD, cUSD, amount2);
      tokenAmount2.should.eq(toEther('202.060614143030626329'));
      await Microcredit.connect(user2).claimLoan(0).should.be.fulfilled;

      let loanUser1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanUser1.tokenAddress.should.eq(cUSD.address);
      loanUser1.amountBorrowed.should.eq(amount1);
      loanUser1.period.should.eq(period);
      loanUser1.dailyInterest.should.eq(dailyInterest);
      loanUser1.claimDeadline.should.eq(claimDeadline);
      loanUser1.startDate.should.eq(statDate + 1);
      loanUser1.lastComputedDebt.should.eq(
        getDebtOnDayX(amount1, dailyInterest, 0)
      );
      loanUser1.currentDebt.should.eq(
        getDebtOnDayX(amount1, dailyInterest, 0)
      );
      loanUser1.amountRepayed.should.eq(0);
      loanUser1.repaymentsLength.should.eq(0);
      loanUser1.lastComputedDate.should.eq(statDate + 1);
      loanUser1.tokenAmountBorrowed.should.eq(loanUser1.amountBorrowed);
      loanUser1.tokenAmountRepayed.should.eq(loanUser1.amountRepayed);
      loanUser1.tokenLastComputedDebt.should.eq(loanUser1.lastComputedDebt);
      loanUser1.tokenCurrentDebt.should.eq(loanUser1.currentDebt);

      let loanUser2 = await Microcredit.callStatic.userLoans(user2.address, 0);
      loanUser2.tokenAddress.should.eq(mUSD.address);
      loanUser2.amountBorrowed.should.eq(amount2);
      loanUser2.period.should.eq(period);
      loanUser2.dailyInterest.should.eq(dailyInterest);
      loanUser2.claimDeadline.should.eq(claimDeadline);
      loanUser2.startDate.should.eq(statDate + 2);
      loanUser2.lastComputedDebt.should.eq(
        getDebtOnDayX(amount2, dailyInterest, 0)
      );
      loanUser2.currentDebt.should.eq(
        getDebtOnDayX(amount2, dailyInterest, 0)
      );
      loanUser2.amountRepayed.should.eq(0);
      loanUser2.repaymentsLength.should.eq(0);
      loanUser2.lastComputedDate.should.eq(statDate + 2);
      loanUser2.tokenAmountBorrowed.should.eq(tokenAmount2);
      loanUser2.tokenAmountRepayed.should.eq(0);
      loanUser2.tokenLastComputedDebt.should.eq(await getExactOutput(mUSD, cUSD, loanUser2.lastComputedDebt));
      loanUser2.tokenCurrentDebt.should.eq(await getExactOutput(mUSD, cUSD, loanUser2.currentDebt));

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount1.add(amount2));

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount1)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(amount1)
      );

      (await mUSD.balanceOf(user2.address)).should.eq(
        initialUser2mUSDBalance.add(tokenAmount2)
      );
      (await mUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditmUSDBalance.sub(tokenAmount2)
      );
    });

    it("should not claimLoan if invalid loan id", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1)
        .claimLoan(1)
        .should.be.rejectedWith("Microcredit: Loan doesn't exist");
      await Microcredit.connect(user2)
        .claimLoan(0)
        .should.be.rejectedWith("Microcredit: Invalid wallet address");
    });

    it("should not claimLoan after claimDeadline", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 5;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await advanceNSecondsAndBlock(10);

      await Microcredit.connect(user1)
        .claimLoan(0)
        .should.be.rejectedWith("Microcredit: Loan expired");
    });

    it("should repayLoan (interest=0)", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;
      const repaymentAmount1 = toEther(10);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1Info.lentAmount.should.eq(amount);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount1);

      await Microcredit.connect(user1)
        .repayLoan(0, repaymentAmount1)
        .should.emit(Microcredit, "RepaymentAdded")
        .withArgs(
          user1.address,
          0,
          repaymentAmount1,
          amount.sub(repaymentAmount1)
        );
      const repaymentDate = await getCurrentBlockTimestamp();

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(amount.sub(repaymentAmount1));
      loan.currentDebt.should.eq(amount.sub(repaymentAmount1));
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment.amount.should.eq(repaymentAmount1);
      repayment.date.should.eq(repaymentDate);

      const manager1InfoAfter = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter.lentAmountLimit.should.eq(
        manager1LentAmountLimit
      );
      manager1InfoAfter.lentAmount.should.eq(
        amount.sub(repaymentAmount1)
      );

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(repaymentAmount1)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(amount).add(repaymentAmount1)
      );
    });

    it("should repayLoan multiple times (interest=0)", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const repaymentAmount1 = toEther(10);
      const repaymentAmount2 = toEther(20);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmount.should.eq(amount);

      await cUSD
        .connect(user1)
        .approve(
          Microcredit.address,
          repaymentAmount1.add(repaymentAmount2)
        );

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(
        amount.sub(repaymentAmount1)
      );

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount2)
        .should.be.fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        amount.sub(repaymentAmount1.add(repaymentAmount2))
      );
      loan.currentDebt.should.eq(
        amount.sub(repaymentAmount1.add(repaymentAmount2))
      );
      loan.amountRepayed.should.eq(
        repaymentAmount1.add(repaymentAmount2)
      );
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(repaymentAmount1);
      repayment1.date.should.eq(repaymentDate1);

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(repaymentAmount2);
      repayment2.date.should.eq(repaymentDate2);

      const manager1InfoAfter2 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter2.lentAmount.should.eq(
        amount.sub(repaymentAmount1).sub(repaymentAmount2)
      );

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance
          .add(amount)
          .sub(repaymentAmount1.add(repaymentAmount2))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(repaymentAmount1.add(repaymentAmount2))
      );
    });

    it("should changeUserAddress if manager", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const repaymentAmount1 = toEther(10);
      const repaymentAmount2 = toEther(20);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount1);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;
      const repaymentDate = await getCurrentBlockTimestamp();

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(amount.sub(repaymentAmount1));
      loan.currentDebt.should.eq(amount.sub(repaymentAmount1));
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment.amount.should.eq(repaymentAmount1);
      repayment.date.should.eq(repaymentDate);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(repaymentAmount1)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(amount).add(repaymentAmount1)
      );

      await Microcredit.connect(maintainer1)
        .changeUserAddress(user1.address, user2.address)
        .should.emit(Microcredit, "UserAddressChanged")
        .withArgs(user1.address, user2.address);

      let walletMetadata1 = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata1.userId.should.eq(1);
      walletMetadata1.movedTo.should.eq(user2.address);
      walletMetadata1.loansLength.should.eq(1);

      let walletMetadata2 = await Microcredit.walletMetadata(
        user2.address
      );
      walletMetadata2.userId.should.eq(1);
      walletMetadata2.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata2.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(2);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);
      (await Microcredit.walletListAt(1)).should.eq(user2.address);

      await Microcredit.callStatic.userLoans(
        user1.address,
        0
      ).should.be.rejectedWith("Microcredit: Invalid wallet address");

      loan = await Microcredit.callStatic.userLoans(user2.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(amount.sub(repaymentAmount1));
      loan.currentDebt.should.eq(amount.sub(repaymentAmount1));
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      ).should.be.rejectedWith("Microcredit: Invalid wallet address");
      repayment = await Microcredit.userLoanRepayments(
        user2.address,
        0,
        0
      );
      repayment.amount.should.eq(repaymentAmount1);
      repayment.date.should.eq(repaymentDate);

      await Microcredit.connect(user1)
        .repayLoan(0, repaymentAmount1)
        .should.be.rejectedWith("Microcredit: Invalid wallet address");
      await cUSD
        .connect(user2)
        .approve(Microcredit.address, repaymentAmount2);
      await Microcredit.connect(user2).repayLoan(0, repaymentAmount2)
        .should.be.fulfilled;
      const repayment2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user2.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        amount.sub(repaymentAmount1.add(repaymentAmount2))
      );
      loan.currentDebt.should.eq(
        amount.sub(repaymentAmount1.add(repaymentAmount2))
      );
      loan.amountRepayed.should.eq(
        repaymentAmount1.add(repaymentAmount2)
      );
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      repayment = await Microcredit.userLoanRepayments(
        user2.address,
        0,
        1
      );
      repayment.amount.should.eq(repaymentAmount2);
      repayment.date.should.eq(repayment2);
    });

    it("should not changeUserAddress if not user", async function () {
      await Microcredit.connect(maintainer1)
        .changeUserAddress(user1.address, user2.address)
        .should.be.rejectedWith(
          "Microcredit: This user cannot be moved"
        );
    });

    it("should not changeUserAddress if already moved", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(maintainer1).changeUserAddress(
        user1.address,
        user2.address
      ).should.be.fulfilled;
      await Microcredit.connect(maintainer1)
        .changeUserAddress(user1.address, user2.address)
        .should.be.rejectedWith(
          "Microcredit: This user cannot be moved"
        );
    });

    it("should not changeUserAddress if target address is user", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(manager1).addLoan(
        user2.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(maintainer1)
        .changeUserAddress(user1.address, user2.address)
        .should.be.rejectedWith(
          "Microcredit: Target wallet address is invalid"
        );
    });

    it("should not changeUserAddress if not maintainer", async function () {
      await Microcredit.connect(user1)
        .changeUserAddress(user1.address, user2.address)
        .should.be.rejectedWith("Microcredit: caller is not a maintainer");
    });

    it("should calculate currentDebt (interest=0)", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1)
        .claimLoan(0)
        .should.emit(Microcredit, "LoanClaimed")
        .withArgs(user1.address, 0);

      const statDate = await getCurrentBlockTimestamp();

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(amount);
      loan.currentDebt.should.eq(amount);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(amount);
      loan.currentDebt.should.eq(amount);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(amount);

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(amount);

      await advanceNSecondsAndBlock(3600 * 24 * 27);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(amount);

      await advanceNSecondsAndBlock(3600 * 24 * 150);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(amount);
    });

    it("should calculate currentDebt #1", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1)
        .claimLoan(0)
        .should.emit(Microcredit, "LoanClaimed")
        .withArgs(user1.address, 0);

      const statDate = await getCurrentBlockTimestamp();

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 0));
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(statDate);

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 1));
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 2));

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 3));

      await advanceNSecondsAndBlock(3600 * 24 * 27);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 30)
      );

      await advanceNSecondsAndBlock(3600 * 24 * 150);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 180)
      );
    });

    it("should calculate currentDebt #2", async function () {
      const amount = toEther(1000);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1)
        .claimLoan(0)
        .should.emit(Microcredit, "LoanClaimed")
        .withArgs(user1.address, 0);

      let loan;

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 1));

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 2));

      await advanceNSecondsAndBlock(3600 * 24);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(getDebtOnDayX(amount, dailyInterest, 3));

      await advanceNSecondsAndBlock(3600 * 24 * 27);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 30)
      );

      await advanceNSecondsAndBlock(3600 * 24 * 150);
      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 180)
      );
    });

    it("should repayLoan after 1 day", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      const expectedCurrentDebt = getDebtOnDayX(amount, dailyInterest, 1);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedCurrentDebt);

      await Microcredit.connect(user1).repayLoan(0, expectedCurrentDebt)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(expectedCurrentDebt);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(expectedCurrentDebt)
      );

      const donation1 = await DonationMiner.donations(1);
      (donation1.donor).should.eq(user1.address);
      (donation1.rewardPeriod).should.eq(1);
      (donation1.amount).should.eq(expectedCurrentDebt.sub(amount).mul(REWARD_MULTIPLIER));
      (donation1.token).should.eq(MICROCREDIT_TOKEN_ADDRESS);
      (donation1.initialAmount).should.eq(
        expectedCurrentDebt.sub(amount).mul(10)
      );

      const donation2 = await DonationMiner.donations(2);
      (donation2.donor).should.eq(manager1.address);
      (donation2.rewardPeriod).should.eq(1);
      (donation2.amount).should.eq(expectedCurrentDebt.sub(amount).mul(REWARD_MULTIPLIER));
      (donation2.token).should.eq(MICROCREDIT_TOKEN_ADDRESS);
      (donation2.initialAmount).should.eq(
        expectedCurrentDebt.sub(amount).mul(10)
      );

      const donation3 = await DonationMiner.donations(3);
      (donation3.donor).should.eq(DEFAULT_LENDER_ADDRESS);
      (donation3.rewardPeriod).should.eq(1);
      (donation3.amount).should.eq(expectedCurrentDebt.sub(amount).mul(REWARD_MULTIPLIER));
      (donation3.token).should.eq(MICROCREDIT_TOKEN_ADDRESS);
      (donation3.initialAmount).should.eq(
        expectedCurrentDebt.sub(amount).mul(10)
      );
    });

    it("should repayLoan after 2 days", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 2 + 100);

      const expectedCurrentDebt = getDebtOnDayX(amount, dailyInterest, 2);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedCurrentDebt);

      await Microcredit.connect(user1).repayLoan(0, expectedCurrentDebt)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 2);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(expectedCurrentDebt);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(expectedCurrentDebt)
      );
    });

    it("should repayLoan after 3 days", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 3 + 1000);

      const expectedCurrentDebt = getDebtOnDayX(amount, dailyInterest, 3);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedCurrentDebt);

      await Microcredit.connect(user1).repayLoan(0, expectedCurrentDebt)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 3);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(expectedCurrentDebt);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(expectedCurrentDebt)
      );
    });

    it("should repayLoan after 30 days", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 30 + 1000);

      const expectedCurrentDebt = getDebtOnDayX(
        amount,
        dailyInterest,
        30
      );

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedCurrentDebt);

      await Microcredit.connect(user1).repayLoan(0, expectedCurrentDebt)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 30);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(expectedCurrentDebt);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(expectedCurrentDebt)
      );
    });

    it("should repayLoan after 180 days", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 180 + 1000);

      const expectedCurrentDebt = getDebtOnDayX(
        amount,
        dailyInterest,
        180
      );

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedCurrentDebt);

      await Microcredit.connect(user1).repayLoan(0, expectedCurrentDebt)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(expectedCurrentDebt);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(expectedCurrentDebt)
      );
    });

    it("should not repay more than current debt", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      const expectedCurrentDebt = getDebtOnDayX(amount, dailyInterest, 1);
      const repaymentAmount = toEther("200");

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount);

      await Microcredit.connect(user1)
        .repayLoan(0, repaymentAmount)
        .should.emit(Microcredit, "RepaymentAdded")
        .withArgs(user1.address, 0, expectedCurrentDebt, 0);

      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(expectedCurrentDebt);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(expectedCurrentDebt)
      );
    });

    it("should not repayLoan after fully repayed", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      await advanceNSecondsAndBlock(3600 * 24);

      const expectedCurrentDebt = getDebtOnDayX(amount, dailyInterest, 1);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedCurrentDebt);

      await Microcredit.connect(user1).repayLoan(0, expectedCurrentDebt)
        .should.be.fulfilled;
      await Microcredit.connect(user1)
        .repayLoan(0, expectedCurrentDebt)
        .should.be.rejectedWith(
          "Microcredit: Loan has already been fully repayed"
        );
    });

    it("should not repayLoan if not claimed yet", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1)
        .repayLoan(0, amount)
        .should.be.rejectedWith("Microcredit: Loan not claimed");
    });

    it("should not repayLoan if invalid wallet address", async function () {
      await Microcredit.connect(user1)
        .repayLoan(0, toEther(1))
        .should.be.rejectedWith("Microcredit: Invalid wallet address");
    });

    it("should not repayLoan if invalid wallet address", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1)
        .repayLoan(1, amount)
        .should.be.rejectedWith("Microcredit: Loan doesn't exist");
    });

    it("should repayLoan multiple times in same day", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      const expectedCurrentDebt = getDebtOnDayX(amount, dailyInterest, 1);
      const repaymentAmount1 = expectedCurrentDebt.div(3);
      const repaymentAmount2 = expectedCurrentDebt.sub(repaymentAmount1);

      await advanceNSecondsAndBlock(3600 * 25);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(
          Microcredit.address,
          repaymentAmount1.add(repaymentAmount2)
        );

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1)
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1)
      );
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmount.should.eq(
        amount.sub(repaymentAmount1)
      );

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount2)
        .should.be.fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(
        repaymentAmount1.add(repaymentAmount2)
      );
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(repaymentAmount1);
      repayment1.date.should.eq(repaymentDate1);

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(repaymentAmount2);
      repayment2.date.should.eq(repaymentDate2);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance
          .add(amount)
          .sub(repaymentAmount1.add(repaymentAmount2))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(repaymentAmount1.add(repaymentAmount2))
      );
    });

    it("should repayLoan multiple times in multiple days", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      const expectedCurrentDebt1 = getDebtOnDayX(
        amount,
        dailyInterest,
        1
      );
      const repaymentAmount1 = expectedCurrentDebt1.div(5);
      const repaymentAmount2 = expectedCurrentDebt1.sub(repaymentAmount1);

      await advanceNSecondsAndBlock(3600 * 25);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt1);

      await cUSD
        .connect(user1)
        .approve(
          Microcredit.address,
          repaymentAmount1.add(repaymentAmount2)
        );

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt1.sub(repaymentAmount1)
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt1.sub(repaymentAmount1)
      );
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmount.should.eq(
        amount.sub(repaymentAmount1)
      );

      await advanceNSecondsAndBlock(3600 * 25);

      const expectedCurrentDebt2 = getDebtOnDayX(
        expectedCurrentDebt1.sub(repaymentAmount1),
        dailyInterest,
        0
      );

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt1.sub(repaymentAmount1)
      );
      loan.currentDebt.should.eq(expectedCurrentDebt2);
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount2)
        .should.be.fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt2.sub(repaymentAmount2)
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt2.sub(repaymentAmount2)
      );
      loan.amountRepayed.should.eq(
        repaymentAmount1.add(repaymentAmount2)
      );
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 2);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(repaymentAmount1);
      repayment1.date.should.eq(repaymentDate1);

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(repaymentAmount2);
      repayment2.date.should.eq(repaymentDate2);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance
          .add(amount)
          .sub(repaymentAmount1.add(repaymentAmount2))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(repaymentAmount1.add(repaymentAmount2))
      );
    });

    it("should add interest after 23h repayment", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      const expectedCurrentDebt1 = getDebtOnDayX(
        amount,
        dailyInterest,
        0
      );
      const repaymentAmount1 = toEther("10");
      const repaymentAmount2 = toEther("20");

      await advanceNSecondsAndBlock(3600 * 23);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt1);

      await cUSD
        .connect(user1)
        .approve(
          Microcredit.address,
          repaymentAmount1.add(repaymentAmount2)
        );

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt1.sub(repaymentAmount1)
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt1.sub(repaymentAmount1)
      );
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await advanceNSecondsAndBlock(3600 * 2);

      const expectedCurrentDebt2 = getDebtOnDayX(
        expectedCurrentDebt1.sub(repaymentAmount1),
        dailyInterest,
        0
      );

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt1.sub(repaymentAmount1)
      );
      loan.currentDebt.should.eq(expectedCurrentDebt2);
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount2)
        .should.be.fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt2.sub(repaymentAmount2)
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt2.sub(repaymentAmount2)
      );
      loan.amountRepayed.should.eq(
        repaymentAmount1.add(repaymentAmount2)
      );
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(repaymentAmount1);
      repayment1.date.should.eq(repaymentDate1);

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(repaymentAmount2);
      repayment2.date.should.eq(repaymentDate2);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance
          .add(amount)
          .sub(repaymentAmount1.add(repaymentAmount2))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
          .sub(amount)
          .add(repaymentAmount1.add(repaymentAmount2))
      );
    });

    it("should cancel loan if manager #1", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      let walletMetadata = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata.userId.should.eq(1);
      walletMetadata.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(0);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(0);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmount.should.eq(amount);

      await Microcredit.connect(manager1)
        .cancelLoans([user1.address], [0])
        .should.emit(Microcredit, "LoanCanceled")
        .withArgs(user1.address, 0);

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(0);
      loan.startDate.should.eq(0);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(0);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);
    });

    it("should cancel loans if manager #2", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(manager1).addLoan(
        user2.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(manager1)
        .cancelLoans([user1.address, user2.address], [0, 0])
        .should.emit(Microcredit, "LoanCanceled")
        .withArgs(user2.address, 0);

      let loan1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan1.claimDeadline.should.eq(0);

      let loan2 = await Microcredit.callStatic.userLoans(user2.address, 0);
      loan2.claimDeadline.should.eq(0);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);
    });

    it("should cancel loan and recalculate manager's lentAmount", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      const manager1Info = await Microcredit.managers(manager1.address);
      manager1Info.lentAmount.should.eq(amount);

      await Microcredit.connect(manager2)
        .cancelLoans([user1.address], [0])
        .should.emit(Microcredit, "LoanCanceled")
        .withArgs(user1.address, 0);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(0);
    });

    it("should not cancel loan if not manager", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1)
        .cancelLoans([user1.address], [0])
        .should.be.rejectedWith(
          Microcredit,
          "Microcredit: caller is not a manager"
        );
    });

    it("should cancel loan if user has been moved", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      let walletMetadata = await Microcredit.walletMetadata(
        user1.address
      );
      walletMetadata.userId.should.eq(1);
      walletMetadata.movedTo.should.eq(ethers.constants.AddressZero);
      walletMetadata.loansLength.should.eq(1);

      (await Microcredit.walletListLength()).should.eq(1);
      (await Microcredit.walletListAt(0)).should.eq(user1.address);

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(0);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(0);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      await Microcredit.connect(maintainer1).changeUserAddress(
        user1.address,
        user2.address
      ).should.be.fulfilled;

      await Microcredit.connect(manager1)
        .cancelLoans([user2.address], [0])
        .should.emit(Microcredit, "LoanCanceled")
        .withArgs(user2.address, 0);

      loan = await Microcredit.callStatic.userLoans(user2.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(0);
      loan.startDate.should.eq(0);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(0);
      loan.repaymentsLength.should.eq(0);
      loan.lastComputedDate.should.eq(0);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);
    });

    it("should not cancel loan if invalid wallet address", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1)
        .cancelLoans([user1.address], [0])
        .should.be.rejectedWith(
          Microcredit,
          "Microcredit: Invalid wallet address"
        );

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(maintainer1).changeUserAddress(
        user1.address,
        user2.address
      ).should.be.fulfilled;

      await Microcredit.connect(manager1)
        .cancelLoans([user1.address], [0])
        .should.be.rejectedWith(
          Microcredit,
          "Microcredit: Invalid wallet address"
        );
    });

    it("should not cancel loan if invalid loan id", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(manager1)
        .cancelLoans([user1.address], [1])
        .should.be.rejectedWith(
          Microcredit,
          "Microcredit: Loan doesn't exist"
        );
    });

    it("should not cancel loan if loan has been claimed", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      await Microcredit.connect(manager1)
        .cancelLoans([user1.address], [0])
        .should.be.rejectedWith(
          Microcredit,
          "Microcredit: Loan already claimed"
        );
    });

    it("should not cancel loan if loan has been canceled", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(manager1).cancelLoans(
        [user1.address],
        [0]
      ).should.be.fulfilled;

      await Microcredit.connect(manager1)
        .cancelLoans([user1.address], [0])
        .should.be.rejectedWith(
          Microcredit,
          "Microcredit: Loan already canceled"
        );
    });

    it("should not claimLoan if loan has been canceled", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 5;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(manager1).cancelLoans(
        [user1.address],
        [0]
      ).should.be.fulfilled;

      await Microcredit.connect(user1)
        .claimLoan(0)
        .should.be.rejectedWith("Microcredit: Loan canceled");
    });

    it("should add loan if previous loan has been canceled", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 5;

      const amount2 = toEther(300);
      const period2 = sixMonth * 2;
      const dailyInterest2 = toEther(0.3);
      const claimDeadline2 = (await getCurrentBlockTimestamp()) + 10;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(manager1).cancelLoans(
        [user1.address],
        [0]
      ).should.be.fulfilled;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount2,
        period2,
        dailyInterest2,
        claimDeadline2
      ).should.be.fulfilled;

      let loan2 = await Microcredit.callStatic.userLoans(user1.address, 1);
      loan2.tokenAddress.should.eq(cUSD.address);
      loan2.amountBorrowed.should.eq(amount2);
      loan2.period.should.eq(period2);
      loan2.dailyInterest.should.eq(dailyInterest2);
      loan2.claimDeadline.should.eq(claimDeadline2);
      loan2.startDate.should.eq(0);
      loan2.lastComputedDebt.should.eq(0);
      loan2.currentDebt.should.eq(0);
      loan2.amountRepayed.should.eq(0);
      loan2.repaymentsLength.should.eq(0);
      loan2.lastComputedDate.should.eq(0);
      loan2.tokenAmountBorrowed.should.eq(loan2.amountBorrowed);
      loan2.tokenAmountRepayed.should.eq(loan2.amountRepayed);
      loan2.tokenLastComputedDebt.should.eq(loan2.lastComputedDebt);
      loan2.tokenCurrentDebt.should.eq(loan2.currentDebt);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(amount2);
    });
  });

  describe("Microcredit - loan functionalities (revenue address != 0)", () => {
    before(async function () {
    });

    const manager1LentAmountLimit = toEther(1000);
    const manager2LentAmountLimit = toEther(3000);

    beforeEach(async () => {
      await deploy();

      await Microcredit.connect(owner).addToken(cUSD.address, [], []);
      await Microcredit.connect(owner).addToken(mUSD.address, [cUSD.address], [10000]);
      await Microcredit.connect(owner).addToken(cTKN.address, [cUSD.address], [10000]);

      await Microcredit.connect(owner).addManagers(
        [manager1.address, manager2.address, manager1.address],
        [
          manager1LentAmountLimit,
          manager2LentAmountLimit,
          manager1LentAmountLimit,
        ]
      );
    });

    it("should repayLoan and redirect revenue #1", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 180 + 1000);

      const expectedCurrentDebt = getDebtOnDayX(
        amount,
        dailyInterest,
        180
      );

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, expectedCurrentDebt);

      await Microcredit.connect(user1).repayLoan(0, expectedCurrentDebt)
        .should.be.fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(expectedCurrentDebt);
      repayment1.date.should.eq(repaymentDate1);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
      );
      (await cUSD.balanceOf(MicrocreditRevenue.address)).should.eq(
        expectedCurrentDebt.sub(amount)
      );
    });

    it("should repayLoan and redirect revenue #2", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 180 + 1000);

      const expectedCurrentDebt = getDebtOnDayX(
        amount,
        dailyInterest,
        180
      );

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD.connect(user1).approve(Microcredit.address, toEther(40));
      await Microcredit.connect(user1).repayLoan(0, toEther(40)).should.be
        .fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(toEther(40))
      );
      loan.currentDebt.should.eq(expectedCurrentDebt.sub(toEther(40)));
      loan.amountRepayed.should.eq(toEther(40));
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(toEther(40));
      repayment1.date.should.eq(repaymentDate1);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(toEther(40))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(amount).add(toEther(40))
      );
      (await cUSD.balanceOf(MicrocreditRevenue.address)).should.eq(0);

      await cUSD.connect(user1).approve(Microcredit.address, toEther(60));
      await Microcredit.connect(user1).repayLoan(0, toEther(60)).should.be
        .fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(60))
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(60))
      );
      loan.amountRepayed.should.eq(toEther(100));
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(toEther(60));
      repayment2.date.should.eq(repaymentDate2);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(toEther(100))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
      );
      (await cUSD.balanceOf(MicrocreditRevenue.address)).should.eq(0);

      await cUSD
        .connect(user1)
        .approve(
          Microcredit.address,
          expectedCurrentDebt.sub(toEther(40)).sub(toEther(60))
        );
      await Microcredit.connect(user1).repayLoan(
        0,
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(60))
      ).should.be.fulfilled;
      const repaymentDate3 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(3);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment3 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        2
      );
      repayment3.amount.should.eq(
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(60))
      );
      repayment3.date.should.eq(repaymentDate3);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
      );
      (await cUSD.balanceOf(MicrocreditRevenue.address)).should.eq(
        expectedCurrentDebt.sub(amount)
      );
    });

    it("should repayLoan and redirect revenue #3", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 180 + 1000);

      const expectedCurrentDebt = getDebtOnDayX(
        amount,
        dailyInterest,
        180
      );

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await cUSD.connect(user1).approve(Microcredit.address, toEther(40));
      await Microcredit.connect(user1).repayLoan(0, toEther(40)).should.be
        .fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(toEther(40))
      );
      loan.currentDebt.should.eq(expectedCurrentDebt.sub(toEther(40)));
      loan.amountRepayed.should.eq(toEther(40));
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(toEther(40));
      repayment1.date.should.eq(repaymentDate1);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(toEther(40))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance.sub(amount).add(toEther(40))
      );
      (await cUSD.balanceOf(MicrocreditRevenue.address)).should.eq(0);

      await cUSD.connect(user1).approve(Microcredit.address, toEther(70));
      await Microcredit.connect(user1).repayLoan(0, toEther(70)).should.be
        .fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(70))
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(70))
      );
      loan.amountRepayed.should.eq(toEther(110));
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(toEther(70));
      repayment2.date.should.eq(repaymentDate2);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(toEther(110))
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
      );
      (await cUSD.balanceOf(MicrocreditRevenue.address)).should.eq(
        toEther(10)
      );

      await cUSD
        .connect(user1)
        .approve(
          Microcredit.address,
          expectedCurrentDebt.sub(toEther(40)).sub(toEther(70))
        );
      await Microcredit.connect(user1).repayLoan(
        0,
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(70))
      ).should.be.fulfilled;
      const repaymentDate3 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(3);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(loan.amountBorrowed);
      loan.tokenAmountRepayed.should.eq(loan.amountRepayed);
      loan.tokenLastComputedDebt.should.eq(loan.lastComputedDebt);
      loan.tokenCurrentDebt.should.eq(loan.currentDebt);

      let repayment3 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        2
      );
      repayment3.amount.should.eq(
        expectedCurrentDebt.sub(toEther(40)).sub(toEther(70))
      );
      repayment3.date.should.eq(repaymentDate3);

      (await cUSD.balanceOf(user1.address)).should.eq(
        initialUser1cUSDBalance.add(amount).sub(expectedCurrentDebt)
      );
      (await cUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcUSDBalance
      );
      (await cUSD.balanceOf(MicrocreditRevenue.address)).should.eq(
        expectedCurrentDebt.sub(amount)
      );
    });

    it("should repayLoan and redirect revenue custom token same price as cUSD", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;
      const tokenRepaymentAmount1 = toEther(40);
      const repaymentAmount1 = await getExactInput(mUSD, cUSD, toEther(40));

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        mUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      const tokenAmount = await getExactOutput(cUSD, mUSD, amount);
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 24 * 180 + 1000);

      const expectedCurrentDebt = getDebtOnDayX(
        amount,
        dailyInterest,
        180
      );

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);

      await mUSD.connect(user1).approve(Microcredit.address, tokenRepaymentAmount1);
      await Microcredit.connect(user1).repayLoan(0, tokenRepaymentAmount1).should.be
        .fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(mUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1)
      );
      loan.currentDebt.should.eq(expectedCurrentDebt.sub(repaymentAmount1));
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(tokenAmount);
      loan.tokenAmountRepayed.should.eq(tokenRepaymentAmount1);
      loan.tokenLastComputedDebt.should.eq(await getExactOutput(cUSD, mUSD, loan.lastComputedDebt));
      loan.tokenCurrentDebt.should.eq(await getExactOutput(cUSD, mUSD, loan.currentDebt));

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(repaymentAmount1);
      repayment1.tokenAmount.should.eq(tokenRepaymentAmount1);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(
        amount.sub(repaymentAmount1)
      );

      (await mUSD.balanceOf(user1.address)).should.eq(
        initialUser1mUSDBalance.add(tokenAmount).sub(tokenRepaymentAmount1)
      );
      (await mUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditmUSDBalance.sub(tokenAmount).add(tokenRepaymentAmount1)
      );
      (await mUSD.balanceOf(MicrocreditRevenue.address)).should.eq(0);

      const tokenRepaymentAmount2 = toEther(70);
      const repaymentAmount2 = await getExactInput(mUSD, cUSD, toEther(70))

      const microcreditShare = await getExactOutput(cUSD, mUSD, amount.sub(repaymentAmount1));
      const microcreditRevenueShare = tokenRepaymentAmount2.sub(microcreditShare);

      await mUSD.connect(user1).approve(Microcredit.address, tokenRepaymentAmount2);
      await Microcredit.connect(user1).repayLoan(0, tokenRepaymentAmount2).should.be
        .fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(mUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1).sub(repaymentAmount2)
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1).sub(repaymentAmount2)
      );
      loan.amountRepayed.should.eq(repaymentAmount1.add(repaymentAmount2));
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(tokenAmount);
      loan.tokenAmountRepayed.should.eq(tokenRepaymentAmount1.add(tokenRepaymentAmount2));
      loan.tokenLastComputedDebt.should.eq(await getExactOutput(cUSD, mUSD, loan.lastComputedDebt));
      loan.tokenCurrentDebt.should.eq(await getExactOutput(cUSD, mUSD, loan.currentDebt));

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(repaymentAmount2);
      repayment2.tokenAmount.should.eq(tokenRepaymentAmount2);
      repayment2.date.should.eq(repaymentDate2);

      const manager1InfoAfter2 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter2.lentAmount.should.eq(0);

      (await mUSD.balanceOf(user1.address)).should.eq(
        initialUser1mUSDBalance.add(tokenAmount).sub(tokenRepaymentAmount1).sub(tokenRepaymentAmount2)
      );
      (await mUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditmUSDBalance.sub(tokenAmount).add(tokenRepaymentAmount1).add(microcreditShare)
      );
      (await mUSD.balanceOf(MicrocreditRevenue.address)).should.eq(
        microcreditRevenueShare
      );

      const tokenRepaymentAmount3 = loan.tokenLastComputedDebt;
      const repaymentAmount3 = await getExactInput(mUSD, cUSD, tokenRepaymentAmount3);

      await mUSD
        .connect(user1)
        .approve(
          Microcredit.address,
          tokenRepaymentAmount3
        );
      await Microcredit.connect(user1).repayLoan(
        0,
        tokenRepaymentAmount3
      ).should.be.fulfilled;
      const repaymentDate3 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(mUSD.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(3);
      loan.lastComputedDate.should.eq(statDate + 3600 * 24 * 180);
      loan.tokenAmountBorrowed.should.eq(tokenAmount);
      loan.tokenAmountRepayed.should.eq(tokenRepaymentAmount1.add(tokenRepaymentAmount2).add(tokenRepaymentAmount3));
      loan.tokenLastComputedDebt.should.eq(0);
      loan.tokenCurrentDebt.should.eq(0);

      let repayment3 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        2
      );
      repayment3.amount.should.eq(repaymentAmount3);
      repayment3.tokenAmount.should.eq(tokenRepaymentAmount3);
      repayment3.date.should.eq(repaymentDate3);

      const manager1InfoAfter3 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter3.lentAmount.should.eq(0);

      (await mUSD.balanceOf(user1.address)).should.eq(
        initialUser1mUSDBalance.add(tokenAmount).sub(tokenRepaymentAmount1.add(tokenRepaymentAmount2).add(tokenRepaymentAmount3))
      );
      (await mUSD.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditmUSDBalance.sub(tokenAmount).add(tokenRepaymentAmount1).add(microcreditShare)
      );
      (await mUSD.balanceOf(MicrocreditRevenue.address)).should.eq(
        microcreditRevenueShare.add(tokenRepaymentAmount3)
      );
    });

    it("should repayLoan and redirect revenue custom token price != cUSD price", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(10);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;
      const repaymentAmount1 = toEther(40);
      const tokenRepaymentAmount1 = await getExactOutput(cUSD, cTKN, repaymentAmount1);
      tokenRepaymentAmount1.should.eq(toEther('80.814545971758548766'));

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cTKN.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      const tokenAmount = await getExactOutput(cUSD, cTKN, amount);
      tokenAmount.should.eq(toEther('202.060614143030626329'));
      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;
      const statDate = await getCurrentBlockTimestamp();

      const expectedCurrentDebt = getDebtOnDayX(
        amount,
        dailyInterest,
        0
      );

      let loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.currentDebt.should.eq(expectedCurrentDebt);
      loan.currentDebt.should.eq(toEther('110'));
      loan.tokenCurrentDebt.should.eq(await getExactOutput(cUSD, cTKN, expectedCurrentDebt));
      loan.tokenCurrentDebt.should.eq(toEther('222.271121869033409573'));

      await cTKN.connect(user1).approve(Microcredit.address, tokenRepaymentAmount1);
      await Microcredit.connect(user1).repayLoan(0, tokenRepaymentAmount1).should.be
        .fulfilled;
      const repaymentDate1 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cTKN.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1)
      );
      loan.lastComputedDebt.should.eq(
        toEther(70)
      );
      loan.currentDebt.should.eq(expectedCurrentDebt.sub(repaymentAmount1));
      loan.amountRepayed.should.eq(repaymentAmount1);
      loan.repaymentsLength.should.eq(1);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(tokenAmount);
      loan.tokenAmountRepayed.should.eq(tokenRepaymentAmount1);
      loan.tokenLastComputedDebt.should.eq(await getExactOutput(cUSD, cTKN, loan.lastComputedDebt));
      loan.tokenLastComputedDebt.should.eq(toEther('141.433942166044660394'));
      loan.tokenCurrentDebt.should.eq(await getExactOutput(cUSD, cTKN, loan.currentDebt));

      let repayment1 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        0
      );
      repayment1.amount.should.eq(repaymentAmount1);
      repayment1.tokenAmount.should.eq(tokenRepaymentAmount1);
      repayment1.date.should.eq(repaymentDate1);

      const manager1InfoAfter1 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter1.lentAmount.should.eq(
        amount.sub(repaymentAmount1)
      );

      (await cTKN.balanceOf(user1.address)).should.eq(
        initialUser1cTKNBalance.add(tokenAmount).sub(tokenRepaymentAmount1)
      );
      (await cTKN.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcTKNBalance.sub(tokenAmount).add(tokenRepaymentAmount1)
      );
      (await cTKN.balanceOf(MicrocreditRevenue.address)).should.eq(0);

      const repaymentAmount2 = toEther(65);
      const tokenRepaymentAmount2 = await getExactOutput(cUSD, cTKN, toEther(65))
      tokenRepaymentAmount2.should.eq(toEther('131.330204239682471854'));

      const microcreditShare = await getExactOutput(cUSD, cTKN, toEther(60));
      const microcreditRevenueShare = tokenRepaymentAmount2.sub(microcreditShare);
      microcreditShare.should.eq(toEther('121.226668412330691806'));
      microcreditRevenueShare.should.eq(toEther('10.103535827351780048'));

      await cTKN.connect(user1).approve(Microcredit.address, tokenRepaymentAmount2);
      await Microcredit.connect(user1).repayLoan(0, tokenRepaymentAmount2).should.be
        .fulfilled;
      const repaymentDate2 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cTKN.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1).sub(repaymentAmount2)
      );
      loan.lastComputedDebt.should.eq(
        toEther(5)
      );
      loan.currentDebt.should.eq(
        expectedCurrentDebt.sub(repaymentAmount1).sub(repaymentAmount2)
      );
      loan.amountRepayed.should.eq(repaymentAmount1.add(repaymentAmount2));
      loan.repaymentsLength.should.eq(2);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(tokenAmount);
      loan.tokenAmountRepayed.should.eq(tokenRepaymentAmount1.add(tokenRepaymentAmount2));
      loan.tokenLastComputedDebt.should.eq(await getExactOutput(cUSD, cTKN, toEther(5)));
      loan.tokenCurrentDebt.should.eq(await getExactOutput(cUSD, cTKN, toEther(5)));
      loan.tokenCurrentDebt.should.eq(toEther('10.101111112121222224'));

      let repayment2 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        1
      );
      repayment2.amount.should.eq(repaymentAmount2);
      repayment2.tokenAmount.should.eq(tokenRepaymentAmount2);
      repayment2.date.should.eq(repaymentDate2);

      const manager1InfoAfter2 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter2.lentAmount.should.eq(0);

      (await cTKN.balanceOf(user1.address)).should.eq(
        initialUser1cTKNBalance.add(tokenAmount).sub(tokenRepaymentAmount1).sub(tokenRepaymentAmount2)
      );
      (await cTKN.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcTKNBalance.sub(tokenAmount).add(tokenRepaymentAmount1).add(microcreditShare)
      );
      (await cTKN.balanceOf(MicrocreditRevenue.address)).should.eq(
        microcreditRevenueShare
      );

      const tokenRepaymentAmount3 = loan.tokenLastComputedDebt;
      const repaymentAmount3 = await getExactInput(cTKN, cUSD, tokenRepaymentAmount3);

      await cTKN
        .connect(user1)
        .approve(
          Microcredit.address,
          tokenRepaymentAmount3
        );
      await Microcredit.connect(user1).repayLoan(
        0,
        tokenRepaymentAmount3
      ).should.be.fulfilled;
      const repaymentDate3 = await getCurrentBlockTimestamp();

      loan = await Microcredit.callStatic.userLoans(user1.address, 0);
      loan.tokenAddress.should.eq(cTKN.address);
      loan.amountBorrowed.should.eq(amount);
      loan.period.should.eq(period);
      loan.dailyInterest.should.eq(dailyInterest);
      loan.claimDeadline.should.eq(claimDeadline);
      loan.startDate.should.eq(statDate);
      loan.lastComputedDebt.should.eq(0);
      loan.currentDebt.should.eq(0);
      loan.amountRepayed.should.eq(expectedCurrentDebt);
      loan.repaymentsLength.should.eq(3);
      loan.lastComputedDate.should.eq(statDate);
      loan.tokenAmountBorrowed.should.eq(tokenAmount);
      loan.tokenAmountRepayed.should.eq(tokenRepaymentAmount1.add(tokenRepaymentAmount2).add(tokenRepaymentAmount3));
      loan.tokenLastComputedDebt.should.eq(0);
      loan.tokenCurrentDebt.should.eq(0);

      let repayment3 = await Microcredit.userLoanRepayments(
        user1.address,
        0,
        2
      );
      repayment3.amount.should.eq(repaymentAmount3);
      repayment3.tokenAmount.should.eq(tokenRepaymentAmount3);
      repayment3.date.should.eq(repaymentDate3);

      const manager1InfoAfter3 = await Microcredit.managers(
        manager1.address
      );
      manager1InfoAfter3.lentAmount.should.eq(0);

      (await cTKN.balanceOf(user1.address)).should.eq(
        initialUser1cTKNBalance.add(tokenAmount).sub(tokenRepaymentAmount1.add(tokenRepaymentAmount2).add(tokenRepaymentAmount3))
      );
      (await cTKN.balanceOf(Microcredit.address)).should.eq(
        initialMicrocreditcTKNBalance.sub(tokenAmount).add(tokenRepaymentAmount1).add(microcreditShare)
      );
      (await cTKN.balanceOf(MicrocreditRevenue.address)).should.eq(
        microcreditRevenueShare.add(tokenRepaymentAmount3)
      );
    });
  });

  describe("Microcredit - change manager", () => {
    before(async function () {
    });

    const manager1LentAmountLimit = toEther(1000);
    const manager2LentAmountLimit = toEther(3000);

    beforeEach(async () => {
      await deploy();

      await Microcredit.connect(owner).updateRevenueAddress(
        Microcredit.address
      );

      await Microcredit.connect(owner).addToken(cUSD.address, [], []);
      await Microcredit.connect(owner).addToken(mUSD.address, [cUSD.address], [10000]);

      await Microcredit.connect(owner).addManagers(
        [manager1.address, manager2.address, manager1.address],
        [
          manager1LentAmountLimit,
          manager2LentAmountLimit,
          manager1LentAmountLimit,
        ]
      );

      await Microcredit.connect(owner)
        .addMaintainers(
          [maintainer1.address, maintainer2.address]
        )
    });

    it("Should not changeBorrowerManager if not maintainer", async function () {
      await Microcredit.connect(manager1)
        .changeBorrowerManager([user1.address], maintainer1.address)
        .should.be.rejectedWith("Microcredit: caller is not a maintainer");
    });

    it("Should not changeBorrowerManager if new manager is not valid", async function () {
      await Microcredit.connect(maintainer1)
        .changeBorrowerManager([user1.address], user2.address)
        .should.be.rejectedWith("Microcredit: invalid manager address");
    });

    it("Should not changeBorrowerManager if invalid borrower", async function () {
      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        toEther(100),
        sixMonth,
        toEther(0.2),
        2000000000
      ).should.be.fulfilled;

      await Microcredit.connect(maintainer1)
        .changeBorrowerManager([user1.address, user2.address], manager1.address)
        .should.be.rejectedWith(
          "Microcredit: invalid borrower address"
        );
    });

    it("Should changeBorrowerManager", async function () {
      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        toEther(100),
        sixMonth,
        toEther(0.2),
        2000000000
      ).should.be.fulfilled;

      await Microcredit.connect(maintainer1)
        .changeBorrowerManager([user1.address], manager1.address)
        .should.emit(Microcredit, "ManagerChanged")
        .withArgs(user1.address, manager1.address);
    });

    it("Should changeBorrowerManager for multiple borrowers", async function () {
      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        toEther(100),
        sixMonth,
        toEther(0.2),
        2000000000
      ).should.be.fulfilled;

      await Microcredit.connect(manager1).addLoan(
        user2.address,
        cUSD.address,
        toEther(100),
        sixMonth,
        toEther(0.2),
        2000000000
      ).should.be.fulfilled;

      await Microcredit.connect(maintainer1)
        .changeBorrowerManager([user1.address, user2.address], manager1.address)
        .should.emit(Microcredit, "ManagerChanged")
        .withArgs(user1.address, manager1.address)
        .withArgs(user2.address, manager1.address);
    });
  });

  describe("Microcredit - editLoan", () => {
    before(async function () {
    });

    const manager1LentAmountLimit = toEther(1000);
    const manager2LentAmountLimit = toEther(3000);

    beforeEach(async () => {
      await deploy();

      await Microcredit.connect(owner).updateRevenueAddress(
        Microcredit.address
      );

      await Microcredit.connect(owner).addToken(cUSD.address, [], []);
      await Microcredit.connect(owner).addToken(mUSD.address, [cUSD.address], [10000]);

      await Microcredit.connect(owner).addManagers(
        [manager1.address, manager2.address, manager1.address],
        [
          manager1LentAmountLimit,
          manager2LentAmountLimit,
          manager1LentAmountLimit,
        ]
      );
    });

    it("Should not editLoan if not owner", async function () {
      await Microcredit.connect(manager1)
        .editLoan(user1.address, 0, 0, 0, 0, 0, 0)
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should not editLoan if invalid loan user", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(owner)
        .editLoan(user2.address, 0, 0, 0, 0, 0, 0)
        .should.be.rejectedWith("Microcredit: Invalid wallet address");
    });

    it("Should not editLoan if invalid loan id", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(owner)
        .editLoan(user1.address, 1, 0, 0, 0, 0, 0)
        .should.be.rejectedWith("Microcredit: Loan doesn't exist");
    });

    it("Should not editLoan if loan not claimed", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(owner)
        .editLoan(user1.address, 0, 0, 0, 0, 0, 0)
        .should.be.rejectedWith(
          "Microcredit: Loan is not active, use cancel method instead"
        );
    });

    it("Should not editLoan if invalid currentLastComputeDate", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const expectedDebt = getDebtOnDayX(amount, dailyInterest, 1);

      const repaymentAmount1 = toEther(50);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      let loanBefore = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanBefore.period.should.eq(period);
      loanBefore.dailyInterest.should.eq(dailyInterest);
      loanBefore.currentDebt.should.eq(expectedDebt);
      loanBefore.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loanBefore.lastComputedDate.should.eq(statDate);
      loanBefore.tokenAmountBorrowed.should.eq(loanBefore.amountBorrowed);
      loanBefore.tokenAmountRepayed.should.eq(loanBefore.amountRepayed);
      loanBefore.tokenLastComputedDebt.should.eq(loanBefore.lastComputedDebt);
      loanBefore.tokenCurrentDebt.should.eq(loanBefore.currentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount1);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;

      let loanAfter1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter1.period.should.eq(period);
      loanAfter1.dailyInterest.should.eq(dailyInterest);
      loanAfter1.currentDebt.should.eq(
        expectedDebt.sub(repaymentAmount1)
      );
      loanAfter1.lastComputedDebt.should.eq(
        expectedDebt.sub(repaymentAmount1)
      );
      loanAfter1.lastComputedDate.should.eq(statDate + 24 * 3600);
      loanAfter1.tokenAmountBorrowed.should.eq(loanAfter1.amountBorrowed);
      loanAfter1.tokenAmountRepayed.should.eq(loanAfter1.amountRepayed);
      loanAfter1.tokenLastComputedDebt.should.eq(loanAfter1.lastComputedDebt);
      loanAfter1.tokenCurrentDebt.should.eq(loanAfter1.currentDebt);

      await Microcredit.connect(owner)
        .editLoan(
          user1.address,
          0,
          loanBefore.lastComputedDate,
          0,
          0,
          0,
          0
        )
        .should.be.rejectedWith(
          "Microcredit: The user has just made a repayment"
        );
    });

    it("Should editLoan just after claiming", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const expectedDebt = getDebtOnDayX(amount, dailyInterest, 1);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      let loanAfter1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter1.period.should.eq(period);
      loanAfter1.dailyInterest.should.eq(dailyInterest);
      loanAfter1.currentDebt.should.eq(expectedDebt);
      loanAfter1.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loanAfter1.lastComputedDate.should.eq(statDate);
      loanAfter1.tokenAmountBorrowed.should.eq(loanAfter1.amountBorrowed);
      loanAfter1.tokenAmountRepayed.should.eq(loanAfter1.amountRepayed);
      loanAfter1.tokenLastComputedDebt.should.eq(loanAfter1.lastComputedDebt);
      loanAfter1.tokenCurrentDebt.should.eq(loanAfter1.currentDebt);

      const newPeriod = oneMonth;
      const newDailyInterest = toEther(0.1);
      const newLastComputedDebt = loanAfter1.lastComputedDebt.add(
        toEther(10)
      );
      const newLastComputedDate = statDate;

      await Microcredit.connect(owner)
        .editLoan(
          user1.address,
          0,
          loanAfter1.lastComputedDate,
          newPeriod,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        )
        .should.emit(Microcredit, "LoanEdited")
        .withArgs(
          user1.address,
          0,
          newPeriod,
          claimDeadline,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        );

      let loanAfter2 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter2.amountBorrowed.should.eq(amount);
      loanAfter2.startDate.should.eq(statDate);
      loanAfter2.amountRepayed.should.eq(0);
      loanAfter2.repaymentsLength.should.eq(0);
      loanAfter2.managerAddress.should.eq(manager1.address);

      loanAfter2.period.should.eq(newPeriod);
      loanAfter2.dailyInterest.should.eq(newDailyInterest);
      loanAfter2.lastComputedDebt.should.eq(newLastComputedDebt);
      loanAfter2.lastComputedDate.should.eq(newLastComputedDate);
      loanAfter2.currentDebt.should.eq(
        getDebtOnDayX(newLastComputedDebt, newDailyInterest, 0)
      );
      loanAfter2.tokenAmountBorrowed.should.eq(loanAfter2.amountBorrowed);
      loanAfter2.tokenAmountRepayed.should.eq(loanAfter2.amountRepayed);
      loanAfter2.tokenLastComputedDebt.should.eq(loanAfter2.lastComputedDebt);
      loanAfter2.tokenCurrentDebt.should.eq(loanAfter2.currentDebt);
    });

    it("Should editLoan just after a repayment", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const expectedDebt = getDebtOnDayX(amount, dailyInterest, 1);

      const repaymentAmount1 = toEther(50);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      let loanBefore = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanBefore.period.should.eq(period);
      loanBefore.dailyInterest.should.eq(dailyInterest);
      loanBefore.currentDebt.should.eq(expectedDebt);
      loanBefore.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loanBefore.lastComputedDate.should.eq(statDate);
      loanBefore.tokenAmountBorrowed.should.eq(loanBefore.amountBorrowed);
      loanBefore.tokenAmountRepayed.should.eq(loanBefore.amountRepayed);
      loanBefore.tokenLastComputedDebt.should.eq(loanBefore.lastComputedDebt);
      loanBefore.tokenCurrentDebt.should.eq(loanBefore.currentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount1);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;

      let loanAfter1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter1.period.should.eq(period);
      loanAfter1.dailyInterest.should.eq(dailyInterest);
      loanAfter1.currentDebt.should.eq(
        expectedDebt.sub(repaymentAmount1)
      );
      loanAfter1.lastComputedDebt.should.eq(
        expectedDebt.sub(repaymentAmount1)
      );
      loanAfter1.lastComputedDate.should.eq(statDate + 24 * 3600);
      loanAfter1.tokenAmountBorrowed.should.eq(loanAfter1.amountBorrowed);
      loanAfter1.tokenAmountRepayed.should.eq(loanAfter1.amountRepayed);
      loanAfter1.tokenLastComputedDebt.should.eq(loanAfter1.lastComputedDebt);
      loanAfter1.tokenCurrentDebt.should.eq(loanAfter1.currentDebt);

      const newPeriod = oneMonth;
      const newDailyInterest = toEther(0.1);
      const newLastComputedDebt = loanAfter1.lastComputedDebt.add(
        toEther(10)
      );
      const newLastComputedDate = statDate;

      await Microcredit.connect(owner)
        .editLoan(
          user1.address,
          0,
          loanAfter1.lastComputedDate,
          newPeriod,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        )
        .should.emit(Microcredit, "LoanEdited")
        .withArgs(
          user1.address,
          0,
          newPeriod,
          claimDeadline,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        );

      let loanAfter2 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter2.amountBorrowed.should.eq(amount);
      loanAfter2.startDate.should.eq(statDate);
      loanAfter2.amountRepayed.should.eq(repaymentAmount1);
      loanAfter2.repaymentsLength.should.eq(1);
      loanAfter2.managerAddress.should.eq(manager1.address);

      loanAfter2.period.should.eq(newPeriod);
      loanAfter2.dailyInterest.should.eq(newDailyInterest);
      loanAfter2.lastComputedDebt.should.eq(newLastComputedDebt);
      loanAfter2.lastComputedDate.should.eq(newLastComputedDate);
      loanAfter2.currentDebt.should.eq(
        getDebtOnDayX(newLastComputedDebt, newDailyInterest, 0)
      );
      loanAfter2.tokenAmountBorrowed.should.eq(loanAfter2.amountBorrowed);
      loanAfter2.tokenAmountRepayed.should.eq(loanAfter2.amountRepayed);
      loanAfter2.tokenLastComputedDebt.should.eq(loanAfter2.lastComputedDebt);
      loanAfter2.tokenCurrentDebt.should.eq(loanAfter2.currentDebt);
    });

    it("Should editLoan a day after a repayment", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const expectedDebt = getDebtOnDayX(amount, dailyInterest, 1);

      const repaymentAmount1 = toEther(50);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      let loanBefore = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanBefore.period.should.eq(period);
      loanBefore.dailyInterest.should.eq(dailyInterest);
      loanBefore.currentDebt.should.eq(expectedDebt);
      loanBefore.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loanBefore.lastComputedDate.should.eq(statDate);
      loanBefore.tokenAmountBorrowed.should.eq(loanBefore.amountBorrowed);
      loanBefore.tokenAmountRepayed.should.eq(loanBefore.amountRepayed);
      loanBefore.tokenLastComputedDebt.should.eq(loanBefore.lastComputedDebt);
      loanBefore.tokenCurrentDebt.should.eq(loanBefore.currentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount1);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;

      await advanceNSecondsAndBlock(3600 * 25);

      let loanAfter1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter1.period.should.eq(period);
      loanAfter1.dailyInterest.should.eq(dailyInterest);
      loanAfter1.lastComputedDebt.should.eq(
        expectedDebt.sub(repaymentAmount1)
      );
      loanAfter1.lastComputedDate.should.eq(statDate + 24 * 3600);
      loanAfter1.currentDebt.should.eq(
        getDebtOnDayX(
          expectedDebt.sub(repaymentAmount1),
          dailyInterest,
          0
        )
      );
      loanAfter1.tokenAmountBorrowed.should.eq(loanAfter1.amountBorrowed);
      loanAfter1.tokenAmountRepayed.should.eq(loanAfter1.amountRepayed);
      loanAfter1.tokenLastComputedDebt.should.eq(loanAfter1.lastComputedDebt);
      loanAfter1.tokenCurrentDebt.should.eq(loanAfter1.currentDebt);

      const newPeriod = oneMonth;
      const newDailyInterest = toEther(0.1);
      const newLastComputedDebt = loanAfter1.lastComputedDebt.add(
        toEther(10)
      );
      const newLastComputedDate = statDate + 24 * 3600;

      await Microcredit.connect(owner)
        .editLoan(
          user1.address,
          0,
          loanAfter1.lastComputedDate,
          newPeriod,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        )
        .should.emit(Microcredit, "LoanEdited")
        .withArgs(
          user1.address,
          0,
          newPeriod,
          claimDeadline,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        );

      let loanAfter2 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter2.amountBorrowed.should.eq(amount);
      loanAfter2.startDate.should.eq(statDate);
      loanAfter2.amountRepayed.should.eq(repaymentAmount1);
      loanAfter2.repaymentsLength.should.eq(1);
      loanAfter2.managerAddress.should.eq(manager1.address);

      loanAfter2.period.should.eq(newPeriod);
      loanAfter2.dailyInterest.should.eq(newDailyInterest);
      loanAfter2.lastComputedDebt.should.eq(newLastComputedDebt);
      loanAfter2.lastComputedDate.should.eq(newLastComputedDate);
      loanAfter2.currentDebt.should.eq(
        getDebtOnDayX(newLastComputedDebt, newDailyInterest, 0)
      );
      loanAfter2.tokenAmountBorrowed.should.eq(loanAfter2.amountBorrowed);
      loanAfter2.tokenAmountRepayed.should.eq(loanAfter2.amountRepayed);
      loanAfter2.tokenLastComputedDebt.should.eq(loanAfter2.lastComputedDebt);
      loanAfter2.tokenCurrentDebt.should.eq(loanAfter2.currentDebt);
    });

    it("Should editLoan after many days after a repayment", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const expectedDebt = getDebtOnDayX(amount, dailyInterest, 1);

      const repaymentAmount1 = toEther(50);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      let loanBefore = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanBefore.period.should.eq(period);
      loanBefore.dailyInterest.should.eq(dailyInterest);
      loanBefore.currentDebt.should.eq(expectedDebt);
      loanBefore.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loanBefore.lastComputedDate.should.eq(statDate);
      loanBefore.tokenAmountBorrowed.should.eq(loanBefore.amountBorrowed);
      loanBefore.tokenAmountRepayed.should.eq(loanBefore.amountRepayed);
      loanBefore.tokenLastComputedDebt.should.eq(loanBefore.lastComputedDebt);
      loanBefore.tokenCurrentDebt.should.eq(loanBefore.currentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount1);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;

      await advanceNSecondsAndBlock(50 * 3600 * 24 + 1);

      let loanAfter1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter1.period.should.eq(period);
      loanAfter1.dailyInterest.should.eq(dailyInterest);
      loanAfter1.lastComputedDebt.should.eq(
        expectedDebt.sub(repaymentAmount1)
      );
      loanAfter1.lastComputedDate.should.eq(statDate + 24 * 3600);
      loanAfter1.currentDebt.should.eq(
        getDebtOnDayX(
          expectedDebt.sub(repaymentAmount1),
          dailyInterest,
          49
        )
      );
      loanAfter1.tokenAmountBorrowed.should.eq(loanAfter1.amountBorrowed);
      loanAfter1.tokenAmountRepayed.should.eq(loanAfter1.amountRepayed);
      loanAfter1.tokenLastComputedDebt.should.eq(loanAfter1.lastComputedDebt);
      loanAfter1.tokenCurrentDebt.should.eq(loanAfter1.currentDebt);

      const newPeriod = oneMonth;
      const newDailyInterest = toEther(0.1);
      const newLastComputedDebt = loanAfter1.lastComputedDebt.add(
        toEther(10)
      );
      const newLastComputedDate = statDate + 20 * 24 * 3600;

      await Microcredit.connect(owner)
        .editLoan(
          user1.address,
          0,
          loanAfter1.lastComputedDate,
          newPeriod,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        )
        .should.emit(Microcredit, "LoanEdited")
        .withArgs(
          user1.address,
          0,
          newPeriod,
          claimDeadline,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        );

      let loanAfter2 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter2.amountBorrowed.should.eq(amount);
      loanAfter2.startDate.should.eq(statDate);
      loanAfter2.amountRepayed.should.eq(repaymentAmount1);
      loanAfter2.repaymentsLength.should.eq(1);
      loanAfter2.managerAddress.should.eq(manager1.address);

      loanAfter2.period.should.eq(newPeriod);
      loanAfter2.dailyInterest.should.eq(newDailyInterest);
      loanAfter2.lastComputedDebt.should.eq(newLastComputedDebt);
      loanAfter2.lastComputedDate.should.eq(newLastComputedDate);
      loanAfter2.currentDebt.should.eq(
        getDebtOnDayX(newLastComputedDebt, newDailyInterest, 30)
      );
      loanAfter2.tokenAmountBorrowed.should.eq(loanAfter2.amountBorrowed);
      loanAfter2.tokenAmountRepayed.should.eq(loanAfter2.amountRepayed);
      loanAfter2.tokenLastComputedDebt.should.eq(loanAfter2.lastComputedDebt);
      loanAfter2.tokenCurrentDebt.should.eq(loanAfter2.currentDebt);
    });

    it("Should editLoan after many days and repay", async function () {
      const amount = toEther(100);
      const period = sixMonth;
      const dailyInterest = toEther(0.2);
      const claimDeadline = (await getCurrentBlockTimestamp()) + 1000;

      const expectedDebt = getDebtOnDayX(amount, dailyInterest, 1);

      const repaymentAmount1 = toEther(50);

      await Microcredit.connect(manager1).addLoan(
        user1.address,
        cUSD.address,
        amount,
        period,
        dailyInterest,
        claimDeadline
      ).should.be.fulfilled;

      await Microcredit.connect(user1).claimLoan(0).should.be.fulfilled;

      const statDate = await getCurrentBlockTimestamp();

      await advanceNSecondsAndBlock(3600 * 25);

      let loanBefore = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanBefore.period.should.eq(period);
      loanBefore.dailyInterest.should.eq(dailyInterest);
      loanBefore.currentDebt.should.eq(expectedDebt);
      loanBefore.lastComputedDebt.should.eq(
        getDebtOnDayX(amount, dailyInterest, 0)
      );
      loanBefore.lastComputedDate.should.eq(statDate);
      loanBefore.tokenAmountBorrowed.should.eq(loanBefore.amountBorrowed);
      loanBefore.tokenAmountRepayed.should.eq(loanBefore.amountRepayed);
      loanBefore.tokenLastComputedDebt.should.eq(loanBefore.lastComputedDebt);
      loanBefore.tokenCurrentDebt.should.eq(loanBefore.currentDebt);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount1);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount1)
        .should.be.fulfilled;

      await advanceNSecondsAndBlock(50 * 3600 * 24 + 1);

      let loanAfter1 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter1.period.should.eq(period);
      loanAfter1.dailyInterest.should.eq(dailyInterest);
      loanAfter1.lastComputedDebt.should.eq(
        expectedDebt.sub(repaymentAmount1)
      );
      loanAfter1.lastComputedDate.should.eq(statDate + 24 * 3600);
      loanAfter1.currentDebt.should.eq(
        getDebtOnDayX(
          expectedDebt.sub(repaymentAmount1),
          dailyInterest,
          49
        )
      );
      loanAfter1.tokenAmountBorrowed.should.eq(loanAfter1.amountBorrowed);
      loanAfter1.tokenAmountRepayed.should.eq(loanAfter1.amountRepayed);
      loanAfter1.tokenLastComputedDebt.should.eq(loanAfter1.lastComputedDebt);
      loanAfter1.tokenCurrentDebt.should.eq(loanAfter1.currentDebt);

      const newPeriod = oneMonth;
      const newDailyInterest = toEther(0.1);
      const newLastComputedDebt = loanAfter1.lastComputedDebt.add(
        toEther(10)
      );
      const newLastComputedDate = statDate + 20 * 24 * 3600;

      await Microcredit.connect(owner)
        .editLoan(
          user1.address,
          0,
          loanAfter1.lastComputedDate,
          newPeriod,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        )
        .should.emit(Microcredit, "LoanEdited")
        .withArgs(
          user1.address,
          0,
          newPeriod,
          claimDeadline,
          newDailyInterest,
          newLastComputedDebt,
          newLastComputedDate
        );

      let loanAfter2 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter2.amountBorrowed.should.eq(amount);
      loanAfter2.startDate.should.eq(statDate);
      loanAfter2.amountRepayed.should.eq(repaymentAmount1);
      loanAfter2.repaymentsLength.should.eq(1);
      loanAfter2.managerAddress.should.eq(manager1.address);

      loanAfter2.period.should.eq(newPeriod);
      loanAfter2.dailyInterest.should.eq(newDailyInterest);
      loanAfter2.lastComputedDebt.should.eq(newLastComputedDebt);
      loanAfter2.lastComputedDate.should.eq(newLastComputedDate);
      loanAfter2.currentDebt.should.eq(
        getDebtOnDayX(newLastComputedDebt, newDailyInterest, 30)
      );
      loanAfter2.tokenAmountBorrowed.should.eq(loanAfter2.amountBorrowed);
      loanAfter2.tokenAmountRepayed.should.eq(loanAfter2.amountRepayed);
      loanAfter2.tokenLastComputedDebt.should.eq(loanAfter2.lastComputedDebt);
      loanAfter2.tokenCurrentDebt.should.eq(loanAfter2.currentDebt);

      const repaymentAmount2 = toEther(10);

      await cUSD
        .connect(user1)
        .approve(Microcredit.address, repaymentAmount2);

      await Microcredit.connect(user1).repayLoan(0, repaymentAmount2)
        .should.be.fulfilled;

      let loanAfter3 = await Microcredit.callStatic.userLoans(user1.address, 0);
      loanAfter3.amountBorrowed.should.eq(amount);
      loanAfter3.startDate.should.eq(statDate);
      loanAfter3.amountRepayed.should.eq(
        repaymentAmount1.add(repaymentAmount2)
      );
      loanAfter3.repaymentsLength.should.eq(2);
      loanAfter3.managerAddress.should.eq(manager1.address);

      loanAfter3.period.should.eq(newPeriod);
      loanAfter3.dailyInterest.should.eq(newDailyInterest);
      loanAfter3.lastComputedDebt.should.eq(
        getDebtOnDayX(newLastComputedDebt, newDailyInterest, 30).sub(
          repaymentAmount2
        )
      );
      loanAfter3.lastComputedDate.should.eq(
        newLastComputedDate + 24 * 3600 * 31
      );
      loanAfter3.currentDebt.should.eq(
        getDebtOnDayX(newLastComputedDebt, newDailyInterest, 30).sub(
          repaymentAmount2
        )
      );
      loanAfter3.tokenAmountBorrowed.should.eq(loanAfter3.amountBorrowed);
      loanAfter3.tokenAmountRepayed.should.eq(loanAfter3.amountRepayed);
      loanAfter3.tokenLastComputedDebt.should.eq(loanAfter3.lastComputedDebt);
      loanAfter3.tokenCurrentDebt.should.eq(loanAfter3.currentDebt);
    });
  });
});
